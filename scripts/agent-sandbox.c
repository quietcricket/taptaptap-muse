/* Linux-only process boundary. Missing kernel support is fatal, never a fallback.
 * No IP socket is created in the child: socket() notifications receive an
 * already-connected Unix socketpair from the trusted Muse relay. connect() is
 * skipped, never continued after inspecting mutable sockaddr memory.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Bookworm's build headers predate ABI 3; runtime support is checked below. */
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

static void fail(const char *message) { perror(message); _exit(126); }
static void rule(int rules, const char *path, uint64_t access, int required) {
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) { if (!required && errno == ENOENT) return; fail("sandbox path"); }
    struct stat st;
    if (fstat(fd, &st)) fail("sandbox stat");
    if (!S_ISDIR(st.st_mode)) access &= LANDLOCK_ACCESS_FS_READ_FILE |
        LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_EXECUTE |
        LANDLOCK_ACCESS_FS_TRUNCATE;
    struct landlock_path_beneath_attr attr = { .allowed_access = access, .parent_fd = fd };
    if (syscall(__NR_landlock_add_rule, rules, LANDLOCK_RULE_PATH_BENEATH, &attr, 0))
        fail("sandbox filesystem rule");
    close(fd);
}
static void filesystem(const char *workspace, const char *config, const char *runtime, int compiler) {
    int abi = syscall(__NR_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 3) { errno = ENOTSUP; fail("sandbox requires Landlock ABI 3+"); }
    uint64_t read = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
    uint64_t write = read | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE |
        LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
        LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
        LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER;
    struct landlock_ruleset_attr attr = { .handled_access_fs = (1ULL << 15) - 1 };
    int rules = syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0);
    if (rules < 0) fail("sandbox ruleset");
    const char *libraries[] = { "/lib", "/lib64", "/usr/lib", "/usr/lib64", NULL };
    for (int i = 0; libraries[i]; i++) rule(rules, libraries[i], read | LANDLOCK_ACCESS_FS_EXECUTE, 0);
    rule(rules, "/usr/local/bin/opencode", read | LANDLOCK_ACCESS_FS_EXECUTE, 1);
    const char *system[] = {
        "/etc/ld.so.cache", "/etc/localtime", "/usr/share/zoneinfo",
        "/etc/nsswitch.conf", "/etc/hosts", "/etc/resolv.conf", "/etc/gai.conf",
        "/proc/self", "/proc/cpuinfo", "/proc/meminfo", "/proc/stat",
        "/sys/devices/system/cpu", "/sys/fs/cgroup", "/dev/urandom",
        "/dev/random", "/dev/zero", "/dev/null", NULL
    };
    for (int i = 0; system[i]; i++) rule(rules, system[i], read, 0);
    /* posix_spawn opens /dev/null for ignored stderr. This discards bytes and
     * grants no write access to any persistent server file. */
    rule(rules, "/dev/null", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE, 1);
    rule(rules, workspace, write, 1);
    rule(rules, runtime, write, 1);
    /* The harness calls mkdir(recursive) even for an existing config folder.
     * Permit directories, but neither creation nor writes of config files. */
    rule(rules, config, read | LANDLOCK_ACCESS_FS_MAKE_DIR, 1);
    if (compiler) {
        rule(rules, "/app", LANDLOCK_ACCESS_FS_READ_DIR, 1);
        rule(rules, "/app/scripts", LANDLOCK_ACCESS_FS_READ_DIR, 1);
        rule(rules, "/app/scripts/build-mode.ts", read, 1);
        rule(rules, "/app/node_modules", read, 1);
        rule(rules, "/app/src/engine", read, 1);
        rule(rules, "/app/src/modes/shared", read, 1);
        rule(rules, "/app/package.json", read, 0);
    } else {
        rule(rules, "/etc/opencode", read, 0);
    }
    if (syscall(__NR_landlock_restrict_self, rules, 0)) fail("sandbox restrict filesystem");
    close(rules);
}

static int filter(int offline) {
    struct sock_filter code[400]; int n = 0;
#define STMT(op, k) code[n++] = (struct sock_filter)BPF_STMT(op, k)
#define JUMP(op, k, yes, no) code[n++] = (struct sock_filter)BPF_JUMP(op, k, yes, no)
#define DENY(call) JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##call, 0, 1); STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
    STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
#if defined(__aarch64__)
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_AARCH64, 1, 0);
#elif defined(__x86_64__)
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0);
#else
#error Unsupported sandbox architecture
#endif
    STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
    STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
#if defined(__x86_64__)
    JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000, 0, 1);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
#endif
    /* Installing a later USER_NOTIF filter could override this socket policy. */
    DENY(seccomp);
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_prctl, 0, 4);
    STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, PR_SET_SECCOMP, 0, 1);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 6);
    STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET, 2, 0);
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET6, 1, 0);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    STMT(BPF_RET | BPF_K, offline ? SECCOMP_RET_ERRNO | EPERM : SECCOMP_RET_USER_NOTIF);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    /* There are no IP sockets to connect. Skip connect rather than inspect its pointer. */
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_connect, 0, 1);
    STMT(BPF_RET | BPF_K, offline ? SECCOMP_RET_ERRNO | EPERM : SECCOMP_RET_ERRNO);
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socketpair, 0, 4);
    STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 0, 1);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    /* The trusted supervisor starts the worker separately. Neither sandboxed
     * process may spawn another process, create namespaces, or leave its session. */
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 4);
    STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
    JUMP(BPF_JMP | BPF_JSET | BPF_K, CLONE_THREAD, 0, 1);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone3, 0, 1);
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS);
    const int signals[] = { __NR_kill, __NR_tgkill, __NR_rt_tgsigqueueinfo };
    for (unsigned i = 0; i < sizeof(signals) / sizeof(signals[0]); i++) {
        JUMP(BPF_JMP | BPF_JEQ | BPF_K, signals[i], 0, 4);
        STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
        JUMP(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)getpid(), 0, 1);
        STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
        STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    }
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_bind, 0, 1);
    STMT(BPF_RET | BPF_K, offline ? SECCOMP_RET_ERRNO | EPERM : SECCOMP_RET_USER_NOTIF);
    JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_listen, 0, 1);
    STMT(BPF_RET | BPF_K, offline ? SECCOMP_RET_ERRNO | EPERM : SECCOMP_RET_ERRNO);
    if (offline) { DENY(accept); DENY(accept4); }
    /* No TCP Fast Open bypass of connect(), including on a bound worker socket. */
    const int sendcalls[] = { __NR_sendto, __NR_sendmsg, __NR_sendmmsg };
    for (unsigned i = 0; i < sizeof(sendcalls) / sizeof(sendcalls[0]); i++) {
        JUMP(BPF_JMP | BPF_JEQ | BPF_K, sendcalls[i], 0, 4);
        STMT(BPF_LD | BPF_W | BPF_ABS,
            offsetof(struct seccomp_data, args[0]) + (i == 1 ? 2 : 3) * 8);
        JUMP(BPF_JMP | BPF_JSET | BPF_K, MSG_FASTOPEN, 1, 0);
        STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
        STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
    }
    DENY(setsid); DENY(setpgid);
    DENY(ptrace); DENY(process_vm_readv); DENY(process_vm_writev);
    DENY(pidfd_open); DENY(pidfd_getfd); DENY(pidfd_send_signal);
    DENY(tkill); DENY(rt_sigqueueinfo); DENY(io_uring_setup);
    DENY(unshare); DENY(setns); DENY(mount); DENY(umount2);
    DENY(pivot_root); DENY(chroot); DENY(open_by_handle_at);
    DENY(bpf); DENY(perf_event_open); DENY(userfaultfd);
    DENY(keyctl); DENY(add_key); DENY(request_key);
    DENY(shmget); DENY(shmat); DENY(shmctl); DENY(msgget); DENY(msgsnd); DENY(msgrcv);
    DENY(semget); DENY(semop); DENY(semtimedop);
    DENY(mq_open); DENY(mq_unlink);
#ifdef __NR_fork
    DENY(fork);
#endif
#ifdef __NR_vfork
    DENY(vfork);
#endif
    STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
    struct sock_fprog program = { .len = (unsigned short)n, .filter = code };
    int fd = syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER,
        offline ? 0 : SECCOMP_FILTER_FLAG_NEW_LISTENER, &program);
    if (fd < 0) fail("sandbox syscall filter");
    return fd;
}
static void send_listener(int channel, int listener) {
    char byte = 'S'; struct iovec iov = { .iov_base = &byte, .iov_len = 1 };
    char control[CMSG_SPACE(sizeof(int))] = {0};
    struct msghdr message = { .msg_iov = &iov, .msg_iovlen = 1,
        .msg_control = control, .msg_controllen = sizeof(control) };
    struct cmsghdr *header = CMSG_FIRSTHDR(&message);
    header->cmsg_level = SOL_SOCKET; header->cmsg_type = SCM_RIGHTS;
    header->cmsg_len = CMSG_LEN(sizeof(int));
    memcpy(CMSG_DATA(header), &listener, sizeof(listener));
    if (sendmsg(channel, &message, 0) != 1) fail("sandbox broker handshake");
}
int main(int argc, char **argv) {
    if (argc < 7) return 126;
    int offline = !strcmp(argv[1], "compiler");
    if (!offline && strcmp(argv[1], "agent")) return 126;
    if (strcmp(argv[6], "/usr/local/bin/opencode")) return 126;
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fail("sandbox no-new-privileges");
    struct rlimit files = {256, 256}, size = {16*1024*1024, 16*1024*1024}, cpu = {60, 60};
    struct rlimit core = {0, 0}, threads = {128, 128};
    if (setrlimit(RLIMIT_NOFILE, &files) || setrlimit(RLIMIT_FSIZE, &size) ||
        setrlimit(RLIMIT_CPU, &cpu) || setrlimit(RLIMIT_CORE, &core) ||
        setrlimit(RLIMIT_NPROC, &threads)) fail("sandbox resource limits");
    filesystem(argv[3], argv[4], argv[5], offline);
    int listener = filter(offline);
    if (!offline) { send_listener(atoi(argv[2]), listener); close(listener); close(atoi(argv[2])); }
    execv(argv[6], &argv[6]);
    fail("sandbox exec");
}
