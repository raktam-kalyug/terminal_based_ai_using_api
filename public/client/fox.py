#!/usr/bin/env python3
"""Fox: A stealth terminal assistant.

Direct, fast, and designed to look and feel like a native terminal shell.
Requires Python 3.8+ only (zero external pip dependencies).
"""

from __future__ import annotations

import argparse
import atexit
import getpass
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

# Default server URL: dynamically substituted when downloaded via http://<host>/fox
DEFAULT_SERVER_URL = "http://localhost:3000"
CONFIG_FILE = Path.home() / ".fox_config.json"
LEGACY_CONFIG = Path.home() / ".lan_gemini_config.json"
HISTORY_FILE = Path.home() / ".fox_history"
VERSION = "2.1.0"

DEFAULT_SYSTEM_PROMPT = (
    "You are Fox, an intelligent, concise terminal assistant. "
    "Provide direct, accurate, and technically sound answers. "
    "Avoid unnecessary conversational filler, intros, or disclaimers. "
    "Format code and lists cleanly for terminal output."
)


class Style:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled

    def _wrap(self, code: str, text: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.enabled else text

    def bold(self, text: str) -> str:
        return self._wrap("1", text)

    def dim(self, text: str) -> str:
        return self._wrap("2", text)

    def green(self, text: str) -> str:
        return self._wrap("32", text)

    def cyan(self, text: str) -> str:
        return self._wrap("36", text)

    def yellow(self, text: str) -> str:
        return self._wrap("33", text)

    def red(self, text: str) -> str:
        return self._wrap("31", text)

    def magenta(self, text: str) -> str:
        return self._wrap("35", text)


def setup_terminal_title(title: str = "fox"):
    if sys.stdout.isatty():
        sys.stdout.write(f"\033]0;{title}\a")
        sys.stdout.flush()


def clear_screen():
    if sys.stdout.isatty():
        os.system("clear" if os.name != "nt" else "cls")


def setup_readline():
    try:
        import readline
        readline.parse_and_bind("tab: complete")
        if HISTORY_FILE.exists():
            try:
                readline.read_history_file(str(HISTORY_FILE))
            except Exception:
                pass

        def save_history():
            try:
                readline.set_history_length(1000)
                readline.write_history_file(str(HISTORY_FILE))
            except Exception:
                pass

        atexit.register(save_history)
    except ImportError:
        pass


def load_config() -> dict[str, str]:
    config: dict[str, str] = {}
    target_config = CONFIG_FILE if CONFIG_FILE.exists() else LEGACY_CONFIG
    if target_config.exists():
        try:
            with open(target_config, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            config = {}

    if "server" not in config:
        config["server"] = (
            os.environ.get("FOX_SERVER")
            or os.environ.get("GEMINI_SERVER")
            or os.environ.get("LAN_GEMINI_SERVER")
            or DEFAULT_SERVER_URL
        )
    if "password" not in config:
        config["password"] = (
            os.environ.get("FOX_PASSWORD")
            or os.environ.get("GEMINI_LAN_PASSWORD")
            or os.environ.get("LAN_GEMINI_PASSWORD")
            or ""
        )

    return config


def save_config(server: str, password: str = "") -> None:
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"server": server.rstrip("/"), "password": password}, f, indent=2)
        try:
            os.chmod(CONFIG_FILE, 0o600)
        except Exception:
            pass
    except Exception as err:
        print(f"Warning: could not save config to {CONFIG_FILE}: {err}", file=sys.stderr)


def copy_to_clipboard(text: str) -> bool:
    commands = []
    if shutil.which("pbcopy"):
        commands.append(["pbcopy"])
    elif shutil.which("wl-copy"):
        commands.append(["wl-copy"])
    elif shutil.which("xclip"):
        commands.append(["xclip", "-selection", "clipboard"])
    elif shutil.which("clip.exe") or shutil.which("clip"):
        commands.append(["clip.exe"] if shutil.which("clip.exe") else ["clip"])

    for cmd in commands:
        try:
            p = subprocess.Popen(cmd, stdin=subprocess.PIPE, close_fds=True)
            p.communicate(input=text.encode("utf-8"))
            if p.returncode == 0:
                return True
        except Exception:
            continue
    return False


def discover_server_udp(timeout: float = 1.0) -> str | None:
    """Send UDP broadcast to discover LAN Fox Chat server on local network."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(timeout)

    targets = ["127.0.0.1", "255.255.255.255"]
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        my_ip = s.getsockname()[0]
        s.close()
        octets = my_ip.split(".")
        if len(octets) == 4:
            targets.append(f"{octets[0]}.{octets[1]}.{octets[2]}.255")
    except Exception:
        pass

    try:
        for tgt in targets:
            try:
                sock.sendto(b"FOX_DISCOVER", (tgt, 35353))
            except Exception:
                continue

        start_t = time.time()
        while time.time() - start_t < timeout:
            try:
                data, addr = sock.recvfrom(1024)
                info = json.loads(data.decode("utf-8"))
                if info.get("app") == "fox-lan-chat":
                    port = info.get("port", 3000)
                    resp_ip = addr[0] if addr[0] != "127.0.0.1" else "localhost"
                    return f"http://{resp_ip}:{port}"
            except (socket.timeout, json.JSONDecodeError):
                break
            except Exception:
                continue
    except Exception:
        pass
    finally:
        sock.close()
    return None


def scan_local_subnet(port: int = 3000, timeout: float = 0.25) -> str | None:
    """Check common IPs on the client's local subnet in case UDP broadcast is blocked."""
    import concurrent.futures

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        my_ip = s.getsockname()[0]
        s.close()
    except Exception:
        return None

    octets = my_ip.split(".")
    if len(octets) != 4:
        return None
    subnet = ".".join(octets[:3])
    my_last = int(octets[3])

    def check_candidate(host_id: int) -> str | None:
        target_ip = f"{subnet}.{host_id}"
        try:
            req = Request(f"http://{target_ip}:{port}/api/health", headers={"Accept": "application/json"})
            with urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("running"):
                    return f"http://{target_ip}:{port}"
        except Exception:
            pass
        return None

    # Priority order: gateway (.1, .2), neighboring hosts, then rest
    priority = [1, 2] + list(range(max(1, my_last - 25), min(255, my_last + 25)))
    seen = set()
    targets = [x for x in priority if not (x in seen or seen.add(x))]

    with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
        futures = {executor.submit(check_candidate, h): h for h in targets}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                return res
    return None


def auto_find_server(last_known_url: str = "") -> str | None:
    """Finds the LAN Fox server when the host Mac's IP address changes."""
    # 1. Try UDP broadcast discovery (fastest ~20ms)
    discovered = discover_server_udp(timeout=1.0)
    if discovered:
        return discovered

    # 2. Extract port from last known URL or default 3000
    target_port = 3000
    if last_known_url:
        try:
            p = urlparse(last_known_url)
            if p.port:
                target_port = p.port
        except Exception:
            pass

    # 3. Subnet scan fallback
    return scan_local_subnet(port=target_port, timeout=0.25)


def request_json(url: str, method: str = "GET", payload: dict | None = None, password: str = "") -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if password:
        headers["x-app-password"] = password

    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as err:
        try:
            detail = json.loads(err.read().decode("utf-8")).get("error")
        except Exception:
            detail = err.reason
        raise RuntimeError(detail or f"HTTP {err.code}") from err
    except URLError as err:
        raise RuntimeError(f"Connection failed ({err.reason}). Check network.") from err


def stream_chat(
    server: str,
    messages: list[dict[str, str]],
    password: str = "",
    system_instruction: str = "",
    style: Style | None = None,
) -> str:
    url = f"{server.rstrip('/')}/api/chat/stream"
    payload: dict = {"messages": messages}
    if system_instruction:
        payload["systemInstruction"] = system_instruction

    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
    }
    if password:
        headers["x-app-password"] = password

    req = Request(url, data=data, headers=headers, method="POST")
    collected: list[str] = []

    try:
        with urlopen(req, timeout=120) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if "text/event-stream" in content_type:
                for raw_line in resp:
                    line = raw_line.decode("utf-8")
                    if not line.startswith("data: "):
                        continue
                    event_data = line[6:].strip()
                    if event_data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(event_data)
                    except json.JSONDecodeError:
                        continue

                    if "error" in chunk:
                        raise RuntimeError(chunk["error"])
                    if "text" in chunk:
                        text_part = chunk["text"]
                        collected.append(text_part)
                        sys.stdout.write(text_part)
                        sys.stdout.flush()
                sys.stdout.write("\n")
                sys.stdout.flush()
                return "".join(collected)
            else:
                body = json.loads(resp.read().decode("utf-8"))
                text = body.get("text", "")
                sys.stdout.write(text + "\n")
                sys.stdout.flush()
                return text

    except HTTPError as err:
        if err.code == 404:
            # Fall back to unary endpoint
            result = request_json(
                f"{server.rstrip('/')}/api/chat",
                method="POST",
                payload=payload,
                password=password,
            )
            text = result.get("text", "")
            sys.stdout.write(text + "\n")
            sys.stdout.flush()
            return text

        try:
            detail = json.loads(err.read().decode("utf-8")).get("error")
        except Exception:
            detail = err.reason
        raise RuntimeError(detail or f"HTTP {err.code}") from err
    except URLError as err:
        raise RuntimeError(f"Connection lost ({err.reason}).") from err


def trigger_panic():
    """Stealth panic screen: clears terminal and shows a realistic fake shell."""
    clear_screen()
    hostname = platform.node().split(".")[0] or "macbook"
    username = getpass.getuser() or "user"
    fake_prompt = f"{username}@{hostname} ~ % "
    try:
        while True:
            cmd = input(fake_prompt).strip()
            if cmd in ("fox", "return", "resume", "fg"):
                clear_screen()
                return
            elif cmd in ("exit", "logout"):
                sys.exit(0)
            elif cmd:
                os.system(cmd)
    except (EOFError, KeyboardInterrupt):
        clear_screen()
        return


def print_stealth_help(style: Style):
    print(f"\n{style.bold('Commands:')}")
    print(f"  {style.yellow('clear')}            Clear terminal screen")
    print(f"  {style.yellow('reset')}            Reset conversation context")
    print(f"  {style.yellow('scan')}             Rescan network if server IP changed")
    print(f"  {style.yellow('panic')}            Disguise screen as ordinary shell")
    print(f"  {style.yellow('!<cmd>')}           Execute a local shell command (e.g., !ls -la)")
    print(f"  {style.yellow('copy')}             Copy last response to clipboard")
    print(f"  {style.yellow('save [file]')}      Save output to markdown/text file")
    print(f"  {style.yellow('system [prompt]')}  View or update system prompt")
    print(f"  {style.yellow('model')}            Show connection status")
    print(f"  {style.yellow('exit')}, {style.yellow('quit')}       Quit")
    print(f"\n{style.dim('Tip: End lines with backslash \\ to continue on next line.')}\n")


def main() -> int:
    config = load_config()

    parser = argparse.ArgumentParser(
        prog="fox",
        description="Fox: stealth terminal assistant.",
    )
    parser.add_argument(
        "prompt",
        nargs="*",
        help="Optional prompt for one-shot execution",
    )
    parser.add_argument(
        "--server",
        "-s",
        default=config.get("server", DEFAULT_SERVER_URL),
        help="Server URL",
    )
    parser.add_argument(
        "--password",
        "-p",
        default=config.get("password", ""),
        help="Access password",
    )
    parser.add_argument(
        "--system",
        default="",
        help="Custom system instruction",
    )
    parser.add_argument(
        "--prompt-label",
        default="fox $ ",
        help="Custom prompt string (default: 'fox $ ')",
    )
    parser.add_argument(
        "--no-clear",
        action="store_true",
        help="Do not clear screen on startup",
    )
    parser.add_argument(
        "--save-config",
        action="store_true",
        help="Save server and password to ~/.fox_config.json",
    )
    parser.add_argument(
        "--reset-config",
        action="store_true",
        help="Reset stored configuration",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Disable ANSI styling",
    )
    parser.add_argument(
        "--scan",
        action="store_true",
        help="Scan local network to find and save Fox server IP",
    )
    parser.add_argument(
        "--version",
        "-v",
        action="version",
        version=f"fox {VERSION}",
    )

    args = parser.parse_args()

    if args.reset_config:
        for f in (CONFIG_FILE, LEGACY_CONFIG):
            if f.exists():
                f.unlink()
        print("Configuration reset.")
        return 0

    server = args.server.rstrip("/")
    password = args.password

    if args.save_config:
        save_config(server, password)
        print(f"Configuration saved to {CONFIG_FILE}")

    use_color = not args.raw and sys.stdout.isatty() and "NO_COLOR" not in os.environ
    style = Style(enabled=use_color)

    if args.scan:
        print(style.dim("Searching local network for Fox server..."))
        found = auto_find_server(server)
        if found:
            save_config(found, password)
            print(f"{style.green('✓ Found and saved:')} {found}")
            return 0
        else:
            print(style.red("No Fox servers discovered on this network."))
            return 1

    # Check connection silently; auto-discover if host IP changed
    try:
        health = request_json(f"{server}/api/health")
    except RuntimeError as err:
        sys.stderr.write(f"{style.dim('Host at ' + server + ' unreachable. Searching LAN for IP change...')}\n")
        new_server = auto_find_server(server)
        if new_server:
            server = new_server
            save_config(server, password)
            sys.stderr.write(f"{style.green('✓ Reconnected to ' + server)}\n")
            try:
                health = request_json(f"{server}/api/health")
            except RuntimeError as err2:
                print(f"Error: {err2}", file=sys.stderr)
                return 1
        else:
            print(f"Error: {err}", file=sys.stderr)
            print("Tip: If host Mac IP changed, ensure server is running or run: fox --scan", file=sys.stderr)
            return 1

    # Discreet password verification if needed
    if not password and not config.get("password"):
        try:
            request_json(
                f"{server}/api/chat",
                method="POST",
                payload={"messages": [{"role": "user", "text": "ping"}]},
                password="",
            )
        except RuntimeError as err:
            if "password" in str(err).lower():
                if sys.stdin.isatty():
                    try:
                        password = getpass.getpass("Password: ").strip()
                        if password:
                            save_config(server, password)
                    except (EOFError, KeyboardInterrupt):
                        print()
                        return 0
                else:
                    print("Error: Server requires an app password. Pass -p <password> or run 'fox' to save it.", file=sys.stderr)
                    return 1

    # Check for piped input from STDIN (e.g. cat file | fox "review")
    piped_input = ""
    if not sys.stdin.isatty():
        try:
            piped_input = sys.stdin.read().strip()
        except Exception:
            piped_input = ""

    # Mode 1: One-shot or Piped command
    pos_prompt = " ".join(args.prompt).strip()
    if pos_prompt or piped_input:
        full_message = pos_prompt
        if piped_input:
            if full_message:
                full_message = f"{full_message}\n\n```\n{piped_input}\n```"
            else:
                full_message = piped_input

        messages = [{"role": "user", "text": full_message}]
        system_inst = args.system or DEFAULT_SYSTEM_PROMPT
        try:
            stream_chat(
                server=server,
                messages=messages,
                password=password,
                system_instruction=system_inst,
                style=style,
            )
            return 0
        except RuntimeError as err:
            print(f"Error: {err}", file=sys.stderr)
            return 1

    # Mode 2: Stealth Interactive Mode
    setup_readline()
    setup_terminal_title("fox")

    # Clean startup: clear the screen completely after establishing connection
    if not args.no_clear:
        clear_screen()

    history: list[dict[str, str]] = []
    system_instruction = args.system or DEFAULT_SYSTEM_PROMPT
    last_response = ""
    multiline_mode = False

    prompt_label = args.prompt_label
    colored_prompt = style.bold(style.cyan(prompt_label)) if use_color else prompt_label

    while True:
        try:
            if multiline_mode:
                multi_lines: list[str] = []
                while True:
                    m_line = input(style.dim("... ") if use_color else "... ")
                    if not m_line:
                        if multi_lines:
                            break
                        else:
                            continue
                    if m_line.strip() in ("/multiline", "multiline"):
                        multiline_mode = False
                        multi_lines = []
                        break
                    multi_lines.append(m_line)
                if not multi_lines:
                    continue
                user_input = "\n".join(multi_lines).strip()
            else:
                user_input = input(colored_prompt)
        except (EOFError, KeyboardInterrupt):
            print()
            break

        # Handle backslash continuation
        if not multiline_mode and user_input.endswith("\\"):
            accumulated = [user_input[:-1]]
            while True:
                try:
                    cont = input(style.dim("... ") if use_color else "... ")
                    if cont.endswith("\\"):
                        accumulated.append(cont[:-1])
                    else:
                        accumulated.append(cont)
                        break
                except (EOFError, KeyboardInterrupt):
                    accumulated = []
                    break
            user_input = "\n".join(accumulated).strip()

        line = user_input.strip()
        if not line:
            continue

        # Normalization for commands (support both 'help' and '/help')
        cmd = line.lower()

        # Stealth Shell Execution: !<command> runs local bash/zsh command
        if line.startswith("!"):
            shell_cmd = line[1:].strip()
            if shell_cmd:
                os.system(shell_cmd)
            continue

        if cmd in ("exit", "quit", "q", ":q", "/exit", "/quit"):
            break

        if cmd in ("clear", "cls", "/clear"):
            clear_screen()
            continue

        if cmd in ("panic", "boss", "/panic"):
            trigger_panic()
            continue

        if cmd in ("reset", "/reset"):
            history.clear()
            last_response = ""
            continue

        if cmd in ("scan", "/scan"):
            print(style.dim("Scanning local network for Fox server..."))
            found = auto_find_server(server)
            if found:
                server = found
                save_config(server, password)
                print(style.green(f"✓ Reconnected to {server}"))
            else:
                print(style.red("No Fox servers discovered on this network."))
            continue

        if cmd in ("help", "/help", "?"):
            print_stealth_help(style)
            continue

        if cmd in ("multiline", "/multiline"):
            multiline_mode = not multiline_mode
            continue

        if cmd == "model" or cmd == "/model":
            try:
                h = request_json(f"{server}/api/health")
                print(f"host: {server} | model: {h.get('model', 'ready')}")
            except Exception as e:
                print(f"offline: {e}")
            continue

        if cmd in ("copy", "/copy"):
            if last_response and copy_to_clipboard(last_response):
                print(style.dim("[copied]"))
            continue

        if line.startswith("save ") or line.startswith("/save "):
            parts = line.split(maxsplit=1)
            filename = parts[1].strip() if len(parts) > 1 else "output.md"
            try:
                with open(filename, "w", encoding="utf-8") as f:
                    for turn in history:
                        f.write(f"{turn['text']}\n\n")
                print(style.dim(f"[saved to {filename}]"))
            except Exception as e:
                print(f"Error: {e}")
            continue

        if line.startswith("system ") or line.startswith("/system "):
            parts = line.split(maxsplit=1)
            if len(parts) > 1:
                system_instruction = parts[1].strip()
            continue

        # Regular Chat Turn
        history.append({"role": "user", "text": line})
        print()  # subtle spacing

        try:
            response_text = stream_chat(
                server=server,
                messages=history,
                password=password,
                system_instruction=system_instruction,
                style=style,
            )
            history.append({"role": "model", "text": response_text})
            last_response = response_text
        except RuntimeError as err:
            history.pop()
            print(f"Error: {err}\n")

        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
