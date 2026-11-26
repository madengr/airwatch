# Airwatch agent runbook

Use [the configuration guide](docs/configuration.md) for operator controls, live providers, and troubleshooting. Airwatch is a local plane-spotting kiosk. Its deployment target is a Raspberry Pi 5 with a CX101PI-C 10.1-inch 1920 × 1200 touchscreen monitor and integrated Pi case.

## Develop and verify on Windows first

From the project root in PowerShell, run `node --version` and `node server.mjs`. Use Node.js 20 or newer. Airwatch has no npm dependencies to install. Open `http://127.0.0.1:8080/` in Chrome or Edge. In a second terminal, `curl.exe --head --fail http://127.0.0.1:8080/` verifies the server responds. Stop the foreground server with Ctrl+C.

Use a fresh browser profile to check startup defaults. Radar opens in Demo near Kansas City with a 40 NM range ring and no selected aircraft. Tap a target to populate **Aircraft Details**, then tap empty scope to clear it. Open **Traffic** and verify it fills automatically with aircraft in scope. To exercise the Pi keypad on Windows, open `http://127.0.0.1:8080/?coordinate-keypad=1` and edit a coordinate or color cutoff under **Settings**.

## Connect over SSH

Connect from Windows on the same LAN. If local SSH configuration selects the `radar` user, use `radar.local`. Otherwise use `radar@radar.local`. Check the saved key and host identity from PowerShell:

```powershell
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 radar.local hostname
```

Expect the hostname `radar` for this installation. For first-time SSH, verify the Pi’s host-key fingerprint and sign in interactively. Enter a password only at the prompt. Investigate a changed host key before connecting. Keep credentials out of commands, logs, and repository files.

If `.local` resolution lags, use the Pi’s local terminal to check the current Wi-Fi address:

```sh
nmcli device status
nmcli -f IP4.ADDRESS device show wlan0
```

Use the actual Wi-Fi device name if it differs. With an already verified key for `radar.local`, pass the current address without its prefix length and keep checking the saved host key:

```powershell
$piAddress = 'PI_WIFI_ADDRESS'
ssh -o "HostName=$piAddress" -o HostKeyAlias=radar.local -o BatchMode=yes -o StrictHostKeyChecking=yes radar.local hostname
```

The same `HostName` and `HostKeyAlias` options work with `scp`. To confirm the return route from within an SSH session, run `set -- $SSH_CONNECTION` and then `ip route get "$1" from "$3"`. A Wi-Fi session on this Pi should show `dev wlan0`.

## Install or update the Pi kiosk

Validate deployments on Windows first. The Pi uses 64-bit Raspberry Pi OS with Desktop and labwc. For a fresh setup, run these commands on the Pi to install the dependencies and check the Node executable used by the unit.

```sh
sudo apt update
sudo apt install nodejs chromium curl
/usr/bin/node --version
```

Copy `server.mjs`, `geoid.mjs`, `terrain.mjs`, `package.json`, and the complete `data/`, `public/`, and `deploy/` directories into `~/.local/share/flight-track` with their layout intact. Run the SSH and SCP lines below in Windows PowerShell from the project root. Put inline Pi shell commands in single quotes so the Pi shell handles expressions such as `~` and `$HOME`. The SCP destination is relative to the `radar` home directory.

```powershell
ssh radar@radar.local 'mkdir -p ~/.local/share/flight-track'
scp -r server.mjs geoid.mjs terrain.mjs package.json data public deploy radar@radar.local:.local/share/flight-track/
```

Preserve the existing kiosk Chromium profile at `${XDG_STATE_HOME:-$HOME/.local/state}/flight-track/chromium`, the optional `~/.config/flight-track/server.env`, and other labwc autostart entries. The profile stores the kiosk’s source and UI settings. Start and verify the service as `radar`, the desktop user:

```sh
cd ~/.local/share/flight-track
mkdir -p ~/.config/systemd/user ~/.config/flight-track ~/.config/labwc
install -m 644 deploy/flight-track.service ~/.config/systemd/user/flight-track.service
systemctl --user daemon-reload
systemctl --user enable --now flight-track.service
curl --head --fail http://127.0.0.1:8080/
```

On first setup, configure a 1920 × 1200 landscape desktop at 1.0× scaling, enable desktop auto-login for `radar`, and turn off screen blanking. In `~/.config/labwc/autostart`, add this line once:

```sh
sh "$HOME/.local/share/flight-track/deploy/start-kiosk.sh" &
```

To test the launcher immediately, run `sh ~/.local/share/flight-track/deploy/start-kiosk.sh` from a terminal in the Pi’s graphical session. After a server update, run `systemctl --user restart flight-track.service` and check its HTTP response. Reload Chromium for interface updates. If the launcher changed, close and reopen Chromium with the launcher. It enables the numeric keypad and Chromium’s kiosk-profile password storage mode. A keypad **Done** applies the edit to the form. **Save settings** persists it in the kiosk profile.

## Verify the deployment

- Check `systemctl --user status flight-track.service --no-pager` and `journalctl --user -u flight-track.service -n 50 --no-pager` for errors if the page is unreachable.
- The installed kiosk uses **Settings → Source → adsb.fi → Save settings** for live traffic. Verify the saved source in the kiosk profile. Set it there if initializing this kiosk from a fresh profile.
- Check that a new kiosk session opens Radar with no aircraft selected. Tap **Traffic** and verify rows appear automatically when the selected feed reports aircraft in scope. Check the feed status when the scope is empty.
- Distinguish local HTTP, live feed, touchscreen, and desktop autostart results in the handoff. Report which checks actually ran.
