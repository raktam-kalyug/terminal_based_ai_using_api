# 🦊 LAN Fox Chat

A fast, private AI chat hub for your local Wi-Fi. Run the server on your primary computer (Mac, Linux, or Windows) with your Gemini API key safely stored in `.env`. Devices on your network can chat through a modern web interface or use the stealth terminal client (**`fox`**).

## Architecture

```text
Phones / Tablets / Terminals ──(Local Wi-Fi)──> Host Server (PC/Mac) ──(HTTPS)──> Gemini API
     (Web UI / Fox CLI)                              │
                                              [.env: API Key]
```

This starter is intended for a trusted home/lab network. Optional `APP_PASSWORD` gives a simple shared passphrase gate; it is not a full account system, and traffic is plain HTTP on the local network. Avoid sending sensitive data over untrusted networks. For wider use, add HTTPS, per-user authentication, rate limiting, and usage controls.

## Quick Start (Interactive Setup Wizard)

1. **Clone the repository**:
   ```sh
   git clone <REPO_URL>
   cd fox-lan-chat
   ```

2. **Run setup**:
   ```sh
   npm start
   ```
   *(Or run `./setup.sh` or `npm run setup`)*

   The interactive wizard will automatically:
   - Detect your local Wi-Fi / Ethernet IP address.
   - Test and find an available port (defaults to `3000`).
   - Prompt for your [Google AI Studio Gemini API key](https://aistudio.google.com/apikey).
   - Generate your secure `.env` file with private permissions (`0600`).
   - Install dependencies if needed and start the server!

3. **Access**:
   - **On the host computer**: `http://localhost:3000`
   - **On other devices on your Wi-Fi**: `http://<HOST_IP>:3000`
   - **On any terminal on your network**:
     ```sh
     curl -sSL http://<HOST_IP>:3000/install | bash
     ```
     Then simply run `fox` in your terminal!

## Mac Internet Sharing / hotspot

On recent macOS versions, open **System Settings → General → Sharing → Internet Sharing**. Select the Mac's upstream connection under **Share your connection from** and enable **Wi-Fi** under **To devices using**. Configure the network name and a strong Wi-Fi password, then enable Internet Sharing. Apple's Internet Sharing guide describes these controls and recommends WPA3 or WPA2/WPA3 where available: [Share your internet connection on Mac](https://support.apple.com/guide/mac-help/share-the-internet-connection-on-mac-mchlp1540/mac).

If your Mac's internet is coming from Wi-Fi, macOS may not let that same Wi-Fi adapter provide the hotspot. Use Ethernet, a USB phone tether, or another upstream interface. A separate phone hotspot can also be used; in that case, connect both the Mac and client devices to it and use the Mac's address on that network.

To find the correct Mac address, with the hotspot active, open **System Settings → General → Sharing → Internet Sharing details** if shown, or **System Settings → Network** and inspect the interface used for the shared network. You can also run `ifconfig` in Terminal and look for the active interface's `inet` address (ignore `127.0.0.1`). Use that address in the browser as `http://MAC_ADDRESS:3000`. The address can change when sharing is toggled, so check again if it stops working.

## Firewall and reachability

The server listens on `0.0.0.0:3000`, which makes it reachable on network interfaces. On the first launch, macOS may ask whether Node can accept incoming connections; allow it for the private network. If blocked, open **System Settings → Network → Firewall → Options** and allow incoming connections for Node. Do not create a router port-forward for this app. Both client devices and Mac must be on the same local Wi-Fi, and the clients need internet access to reach Gemini through the Mac.

Quick troubleshooting:

- Mac page works but other devices time out: check the Mac's Wi-Fi/private-network address, firewall permission, and that both devices are on the same hotspot.
- The page loads but chat errors: check `.env`, API key validity, model availability, Gemini quota, and that the Mac itself has internet access.
- “Enter the shared app password”: the server has `APP_PASSWORD` set; use Settings (gear icon) on each browser.

## Stealth Terminal Assistant (`fox`)

The server provides a stealth terminal client named **`fox`** for any device on your local network. It requires only standard Python 3.8+ (zero pip packages required), keeps the Gemini API key safe on your host Mac, and is designed to look and feel like an ordinary terminal subshell.

### 1. One-Line Install (Recommended)

On any machine connected to your local network, run:

```sh
curl -sSL http://<MAC_IP>:3000/install | bash
```

This installs `fox` directly into `~/.local/bin/fox` (along with a `gemini` symlink) and automatically pre-configures it to connect to your Mac's IP.

*(Alternatively, download it manually without installing:)*
```sh
curl -sSL http://<MAC_IP>:3000/fox -o fox && chmod +x fox
./fox
```

### 2. Stealth Features

- **Clean connection**: Once connected, the terminal screen is cleared automatically with no flashy AI banners, ASCII art, or provider logos.
- **Realistic prompt**: The prompt appears as `fox $ ` (or can be customized with `--prompt-label`).
- **Direct responses**: Output streams directly as clean terminal text with no AI disclaimers or verbose conversation filler.
- **Process title**: The terminal tab/window title is set simply to `fox`.
- **Panic button (`panic`)**: Instantly clears the screen and presents a convincing fake bash/zsh shell prompt. Type `fox` or `fg` to resume.
- **Shell passthrough (`!<cmd>`)**: Run actual system commands directly from inside `fox` (e.g. `!ls -la`, `!pwd`, `!git status`) so it blends seamlessly with regular terminal workflows.

### 3. Usage Modes

#### A. Interactive Stealth Shell
Simply launch `fox`:
```sh
fox
```
- **Real-time token streaming**: responses stream in live as they are generated.
- **Readline history**: use `Up`/`Down` arrow keys to recall previous inputs.
- **Line continuation**: end a line with `\` to enter multi-line text across several lines.
- **Built-in commands**:
  - `clear`: clear the screen immediately
  - `panic`: disguise the terminal as a standard shell
  - `!<cmd>`: run a real local command without leaving (e.g., `!ls`, `!git log`)
  - `copy`: copy the last answer directly to your clipboard
  - `save [filename]`: export conversation or answer to markdown
  - `reset`: clear conversation history
  - `help`: view stealth command guide
  - `exit` or `quit`: exit cleanly

#### B. Quick One-Shot Execution
Ask a question directly from the command line without entering the interactive shell:
```sh
fox "What is the command to check open listening ports on macOS?"
```

#### C. Unix Pipeline & STDIN (Code review, logs, and files)
Pipe logs, git diffs, or code files straight into `fox`:
```sh
# Analyze an error log
cat error.log | fox "What caused this error and how do I fix it?"

# Generate a git commit message from staged changes
git diff --staged | fox "Write a concise conventional git commit message"

# Summarize a file
cat notes.txt | fox "Provide a 3-bullet summary"
```

### 4. Configuration

`fox` automatically remembers your server URL and app password in `~/.fox_config.json`.
- Override server: `fox --server http://192.168.1.50:3000`
- Save new default: `fox --server http://192.168.1.50:3000 --save-config`
- Pass app password: `fox -p mySecretPassword`
- Clear configuration: `fox --reset-config`
