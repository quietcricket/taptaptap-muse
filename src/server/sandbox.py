"""Per-turn Linux sandbox and credential-holding, fixed-destination Muse relay.

Outbound sockets are connected Unix pairs, never unconnected IP sockets.
The only IP listener is the current turn's private harness worker, bound to
loopback by the parent. Seccomp notifications are emulated, never CONTINUE.
The real API key remains in the parent relay.
"""

import array
import errno
import fcntl
import http.client
import http.server
import json
import os
import platform
import select
import signal
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

SANDBOX = "/usr/local/bin/taptaptap-sandbox"
MODEL_ID = "muse-wonder-1.0"
RELAY_HOST = "127.0.0.1:9"
MAX_BODY = 2_000_000
MAX_RESPONSE = 16_000_000
# Linux uapi seccomp.h ioctl encodings, identical on the supported 64-bit ABIs.
NOTIF_RECV = 0xC0502100
NOTIF_SEND = 0xC0182101
NOTIF_ADDFD = 0x40182103


def sandbox_command(kind, channel, workspace, config, runtime, arguments):
    if not Path(SANDBOX).is_file():
        raise RuntimeError(
            "The isolated agent runtime is unavailable; use the container"
        )
    return [
        SANDBOX,
        kind,
        str(channel),
        str(workspace),
        str(config),
        str(runtime),
        "/usr/local/bin/opencode",
        *arguments,
    ]


def validate_request(path, headers, body):
    if path != "/v1/responses" or headers.get("Host") != RELAY_HOST:
        raise ValueError("Destination is not allowed")
    if headers.get("Transfer-Encoding"):
        raise ValueError("Streaming request bodies are not allowed")
    payload = json.loads(body)
    if not isinstance(payload, dict) or payload.get("model") != MODEL_ID:
        raise ValueError("Only the configured Muse model is allowed")
    if payload.get("background") or payload.get("max_output_tokens", 16384) > 16384:
        raise ValueError("Request exceeds the model limits")
    tools = payload.get("tools", [])
    if not isinstance(tools, list) or any(
        not isinstance(tool, dict) or tool.get("type") != "function" for tool in tools
    ):
        raise ValueError("Server-side network and execution tools are not allowed")

    def text_only(value):
        if isinstance(value, dict):
            if any(
                key in value
                for key in ("image_url", "file_url", "audio_url", "video_url")
            ):
                raise ValueError("Remote input resources are not allowed")
            for item in value.values():
                text_only(item)
        elif isinstance(value, list):
            for item in value:
                text_only(item)

    text_only(payload.get("input"))
    return payload


class MuseRelay:
    def __init__(self, settings):
        self.settings = settings
        self.context = ssl.create_default_context(
            cafile=settings.agent_ca_bundle or None
        )
        self.connections = set()
        self.channels = set()
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.requests = 0
        self.listeners = {}

    def private_port(self, host):
        parsed = urlsplit("//" + (host or ""))
        if parsed.hostname not in {"127.0.0.1", "localhost"}:
            return None
        with self.lock:
            return parsed.port if parsed.port in self.listeners else None

    def internal(self, method, path, request_headers, body, send_headers, send_chunk):
        # OpenCode v2 needs its own private backend. Only this turn's randomly
        # allocated listener is reachable; never a caller-selected local service.
        port = self.private_port(request_headers.get("Host"))
        if port is None or not path.startswith("/") or path.startswith("//"):
            raise ValueError("Private endpoint is not allowed")
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=240)
        with self.lock:
            if self.stopped.is_set():
                raise ValueError("Relay is closed")
            self.connections.add(connection)
        try:
            headers = {
                key: value
                for key, value in request_headers.items()
                if key.lower()
                not in {"host", "connection", "transfer-encoding", "accept-encoding"}
            }
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            if 300 <= response.status < 400:
                raise ValueError("Private redirects are not allowed")
            send_headers(
                response.status, response.getheader("Content-Type", "application/json")
            )
            total = 0
            while not self.stopped.is_set():
                chunk = response.read1(16_384)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_RESPONSE:
                    raise ValueError("Private response exceeds its limit")
                send_chunk(chunk)
        finally:
            connection.close()
            with self.lock:
                self.connections.discard(connection)

    def upstream(self, body, send_headers, send_chunk):
        # Neither host nor port, path, TLS verification, or auth is caller-controlled.
        connection = http.client.HTTPSConnection(
            "api.meta.ai",
            443,
            context=self.context,
            timeout=90,
        )
        with self.lock:
            if self.stopped.is_set() or self.requests >= 64:
                raise ValueError("Relay request limit reached")
            self.requests += 1
            self.connections.add(connection)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=body,
                headers={
                    "Authorization": "Bearer " + self.settings.meta_api_key,
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream, application/json",
                },
            )
            response = connection.getresponse()
            if 300 <= response.status < 400:
                raise ValueError("Muse redirects are not allowed")
            content_type = response.getheader("Content-Type", "application/json")
            send_headers(response.status, content_type)
            total = 0
            while not self.stopped.is_set():
                chunk = response.read1(16_384)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_RESPONSE:
                    raise ValueError("Muse response exceeds its limit")
                send_chunk(chunk)
        finally:
            connection.close()
            with self.lock:
                self.connections.discard(connection)

    def handle(self, channel):
        relay = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def dispatch(self):
                sent = False

                def headers(status, content_type):
                    nonlocal sent
                    self.send_response(status)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Transfer-Encoding", "chunked")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    sent = True

                def chunk(data):
                    self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
                    self.wfile.flush()

                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 <= length <= MAX_BODY or self.headers.get(
                        "Transfer-Encoding"
                    ):
                        raise ValueError("Invalid request size")
                    if sum(len(k) + len(v) for k, v in self.headers.items()) > 16000:
                        raise ValueError("Headers exceed the limit")
                    body = self.rfile.read(length)
                    if relay.private_port(self.headers.get("Host")) is not None:
                        relay.internal(
                            self.command, self.path, self.headers, body, headers, chunk
                        )
                    else:
                        if self.command != "POST":
                            raise ValueError("Only model requests are allowed")
                        validate_request(self.path, self.headers, body)
                        relay.upstream(body, headers, chunk)
                    self.wfile.write(b"0\r\n\r\n")
                    self.wfile.flush()
                except (ValueError, KeyError, TypeError):
                    if not sent:
                        self.send_error(403, "Only the configured Muse API is allowed")
                except (OSError, http.client.HTTPException):
                    if not sent:
                        self.send_error(502, "Muse API transport unavailable")
                self.close_connection = True

            do_GET = do_HEAD = do_PUT = do_DELETE = do_PATCH = do_CONNECT = do_POST = (
                dispatch
            )

        try:
            channel.settimeout(100)
            Handler(channel, ("sandbox", 0), SimpleNamespace())
        except OSError:
            pass
        finally:
            channel.close()
            with self.lock:
                self.channels.discard(channel)

    def close(self):
        self.stopped.set()
        with self.lock:
            channels = list(self.channels)
            connections = list(self.connections)
            listeners = list(self.listeners.values())
        for connection in connections:
            if connection.sock:
                try:
                    connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        for channel in channels:
            try:
                channel.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            channel.close()
        for listener in listeners:
            listener.close()


class AgentSandbox:
    def __init__(self, settings, workspace, config, runtime, relay=None):
        self.workspace, self.config, self.runtime = workspace, config, runtime
        self.owns_relay = relay is None
        self.relay = relay or MuseRelay(settings)
        self.parent, self.child = socket.socketpair()
        self.listener = None
        self.worker = None
        self.process_pid = None
        self.stopped = threading.Event()

    @property
    def pass_fds(self):
        return (self.child.fileno(),)

    def command(self, arguments):
        return sandbox_command(
            "agent",
            self.child.fileno(),
            self.workspace,
            self.config,
            self.runtime,
            arguments,
        )

    def start(self, process_pid):
        self.process_pid = process_pid
        self.child.close()
        self.worker = threading.Thread(target=self.serve, daemon=True)
        self.worker.start()

    def serve(self):
        try:
            self.parent.settimeout(5)
            _, ancillary, _, _ = self.parent.recvmsg(1, socket.CMSG_SPACE(4))
            for level, kind, data in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    descriptors = array.array("i")
                    descriptors.frombytes(data[:4])
                    self.listener = descriptors[0]
            if self.listener is None:
                return
            while not self.stopped.is_set():
                ready, _, _ = select.select([self.listener], [], [], 0.2)
                if not ready:
                    continue
                request = bytearray(80)
                try:
                    fcntl.ioctl(self.listener, NOTIF_RECV, request, True)
                except OSError as error:
                    if error.errno in {errno.ENOENT, errno.EINTR}:
                        continue
                    break
                ident = struct.unpack_from("Q", request)[0]
                number = struct.unpack_from("i", request, 16)[0]
                arguments = struct.unpack_from("QQQQQQ", request, 32)
                bind_number = 200 if platform.machine() == "aarch64" else 49
                if number == bind_number:
                    listener = None
                    try:
                        with self.relay.lock:
                            if self.relay.listeners:
                                raise PermissionError("One private worker per turn")
                        # Ignore the child's sockaddr completely. Binding is
                        # always to a fresh private loopback port, never 0.0.0.0.
                        listener = socket.socket(
                            socket.AF_INET, socket.SOCK_STREAM | socket.SOCK_NONBLOCK
                        )
                        listener.bind(("127.0.0.1", 0))
                        listener.listen(16)
                        addfd = struct.pack(
                            "QIIII",
                            ident,
                            1,
                            listener.fileno(),
                            arguments[0],
                            os.O_CLOEXEC,
                        )
                        fcntl.ioctl(self.listener, NOTIF_ADDFD, addfd)
                        with self.relay.lock:
                            self.relay.listeners[listener.getsockname()[1]] = listener
                        fcntl.ioctl(
                            self.listener,
                            NOTIF_SEND,
                            struct.pack("QqiI", ident, 0, 0, 0),
                        )
                    except OSError:
                        if listener:
                            listener.close()
                        fcntl.ioctl(
                            self.listener,
                            NOTIF_SEND,
                            struct.pack("QqiI", ident, 0, -errno.EPERM, 0),
                        )
                    continue
                # Only socket() notifications are generated. Arguments are values,
                # never child-controlled pointers or sockaddr memory.
                family, kind, protocol = struct.unpack_from("QQQ", request, 32)
                with self.relay.lock:
                    full = len(self.relay.channels) >= 8
                if (
                    family not in {socket.AF_INET, socket.AF_INET6}
                    or kind & 0xF != socket.SOCK_STREAM
                    or protocol not in {0, socket.IPPROTO_TCP}
                    or full
                ):
                    response = struct.pack("QqiI", ident, 0, -errno.EPERM, 0)
                    fcntl.ioctl(self.listener, NOTIF_SEND, response)
                    continue
                host, child = socket.socketpair()
                child.setblocking(not bool(kind & socket.SOCK_NONBLOCK))
                addfd = struct.pack(
                    "QIIII",
                    ident,
                    2,
                    child.fileno(),
                    0,
                    os.O_CLOEXEC if kind & socket.SOCK_CLOEXEC else 0,
                )
                try:
                    # ADDFD_FLAG_SEND atomically installs the Unix FD and replies.
                    fcntl.ioctl(self.listener, NOTIF_ADDFD, addfd)
                except OSError:
                    host.close()
                    child.close()
                    continue
                child.close()
                with self.relay.lock:
                    self.relay.channels.add(host)
                threading.Thread(
                    target=self.relay.handle, args=(host,), daemon=True
                ).start()
        except OSError:
            pass

    def close(self):
        self.stopped.set()
        if self.owns_relay:
            self.relay.close()
        if self.process_pid:
            try:
                os.killpg(self.process_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.parent.close()
        self.child.close()
        if self.worker:
            self.worker.join(timeout=2)
        if self.listener is not None:
            os.close(self.listener)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class PrivateWorker:
    """Supervisor-owned backend: the harness itself cannot spawn processes."""

    def __init__(self, settings, workspace, config, runtime, env):
        import secrets

        self.boundary = AgentSandbox(settings, workspace, config, runtime)
        self.env = {**env, "OPENCODE_PASSWORD": secrets.token_urlsafe(32)}
        self.workspace = workspace
        self.process = None
        self.errors = tempfile.TemporaryFile()
        self.url = None

    @property
    def relay(self):
        return self.boundary.relay

    def __enter__(self):
        try:
            self.process = subprocess.Popen(
                self.boundary.command(["serve", "--stdio", "--port", "0"]),
                cwd=self.workspace,
                env=self.env,
                pass_fds=self.boundary.pass_fds,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self.errors,
                start_new_session=True,
            )
            self.boundary.start(self.process.pid)
            deadline = time.monotonic() + 15
            pending = b""
            while time.monotonic() < deadline:
                ready, _, _ = select.select([self.process.stdout], [], [], 0.2)
                if not ready:
                    continue
                data = os.read(self.process.stdout.fileno(), 4096)
                if not data:
                    break
                pending += data
                if len(pending) > 32_000:
                    break
                if b"\n" not in pending:
                    continue
                line, _ = pending.split(b"\n", 1)
                url = json.loads(line).get("url", "")
                parsed = urlsplit(url)
                if (
                    parsed.scheme != "http"
                    or self.relay.private_port(parsed.netloc) is None
                ):
                    raise RuntimeError("Invalid private worker endpoint")
                self.url = url
                return self
            self.errors.seek(0)
            raise RuntimeError(
                "Private worker did not start: "
                + self.errors.read(4000).decode(errors="replace")
            )
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.process and self.process.stdin:
            self.process.stdin.close()
        self.boundary.close()
        if self.process:
            self.process.wait(timeout=5)
            if self.process.stdout:
                self.process.stdout.close()
        self.errors.close()

    def __exit__(self, *args):
        self.close()
