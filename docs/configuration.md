# Airwatch configuration and troubleshooting

See the [Airwatch project overview](../README.md) and [illustrated user manual](Airwatch-User-Manual.pdf) for an introduction to the touchscreen controls.

## Run on Windows

Install Node.js 20 or newer if needed. Open PowerShell in this project folder and run the server. The app has no npm dependencies to install. [Node.js downloads](https://nodejs.org/en/download)

```powershell
node --version
node server.mjs
```

Open [Airwatch at 127.0.0.1:8080](http://127.0.0.1:8080/) in Edge or Chrome. Tap **Full screen** or press **F11** to try fullscreen. **Ctrl+C** in PowerShell stops the server. Use the same address, port, and browser profile to keep your settings. The server listens on the local loopback address by default.

## Use the touchscreen

- Tap **Radar**, **Traffic**, or **Settings** in the header, or swipe left or right between pages. The keyboard’s left and right arrow keys also switch pages. The header’s **Age** shows the elapsed time since the latest traffic update, and the square icon toggles full screen.
- In **Radar**, tap an aircraft to see its details or tap open space on the scope to clear the selection. **Aircraft Details** stays the same height, leaves unavailable fields blank, and uses the configured altitude, ground speed, and squawk colors. **Altitude MSL/AGL** shows both values in feet, with a dash for missing AGL when MSL is available. AGL subtracts the active scope center’s estimated terrain elevation from MSL. This uses the same point as the range rings, whether you use a preset default or custom coordinates. **Range** measures from that point. Use the range controls in the Radar header to set the outer ring from 1 to 100 nautical miles. The center control opens the list of supported ranges.
- The **GROUND** and **AIRBORNE** buttons in the Radar header filter their respective aircraft categories in Radar, Nearby aircraft, and Traffic. Both are on by default. Airwatch saves each button’s setting in the browser profile.
- In **Nearby aircraft** and **Traffic**, tap **Time**, **Ident**, **MSL**, **AGL**, **SPD**, **SQK**, or **RNG** to sort. **RNG** measures from the active radar center in nautical miles. Both views initially show the newest aircraft first, based on the UTC time Airwatch first saw each one. Tap the active header again to reverse the order. Each view remembers its column and direction when you reopen Airwatch in the same browser profile.
- **Nearby aircraft** and **Traffic** show the reported aircraft type and use matching colors for altitude, speed, and squawk. Both altitude columns use hundreds of feet (`095` is 9,500 feet), ground speed is in knots, and range is in nautical miles.
- In **Traffic**, browse aircraft visible on the radar scope. Tap an aircraft to select it on **Radar**. Fields such as type, registration, and altitude depend on what the feed reports.
- In **Settings**, choose the scope center and select **Demo** or a named provider under **Source**, then tap **Save settings**. Settings are saved in the browser profile on that device.
- **Settings** also has optional chimes for newly observed live aircraft and reported emergencies. Regular desktop browsers may require a tap before playing sound.

A fresh browser profile opens **Radar** in **Demo** around Kansas City, Missouri, with a 40 NM range ring and no aircraft selected. The standard basemap and simulated traffic run offline. Online map backgrounds and the weather overlay require internet access. [Natural Earth basemap data](https://www.naturalearthdata.com/about/terms-of-use/)

### Choose a map background

Use the map background selector on **Radar** to switch between the black **Radar Map**, **USGS Imagery**, **VFR Sectional**, **IFR Low**, and **IFR High**. The scope remembers the choice in the browser profile. Traffic, range rings, and weather draw over the selected background.

- **USGS Imagery** uses The National Map, with more detailed U.S. aerial imagery at closer ranges. [USGS imagery sources by scale](https://www.usgs.gov/faqs/what-sources-were-used-imagery-national-map-services)
- The **VFR Sectional**, **IFR Low**, and **IFR High** options use the FAA’s published chart tiles. A tighter range makes small chart text easier to read. Coverage varies by chart. [FAA VFR charts](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/) · [FAA IFR en route charts](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/ifr/)

### Choose an airspace preset and scope center

The first launch centers on Kansas City at 39.0997° N, 94.5786° W. Under **Settings → Monitoring location**, choose an **Airspace preset**, such as **Kansas City Center (ZKC)**, and set **Scope Center** to **Preset default** to use the FAA reference point shown in the read-only latitude and longitude fields. Choose **Custom coordinates** to edit those fields. Enter decimal degrees, with positive latitude north and positive longitude east. Choose **No airspace preset** to use custom coordinates without an airspace outline. Airwatch keeps your custom coordinates when you switch back to a preset center. Tap **Save settings** to apply changes. [FAA ARTCC data](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/2026-10-29/)

The **Radar preview** updates as you change the preset, coordinates, or range. It draws the offline basemap with airport marks, range rings, and any selected airspace outline. **Save settings** applies those choices to the live scope and traffic feed.

A dashed outline shows the charted high-altitude ARTCC boundary where it falls within the view. Honolulu uses the charted Honolulu Control Facility control area. The ring keeps its selected range, and the traffic list still shows positions across the scope according to feed coverage. A center’s full footprint may extend beyond the displayed area. [FAA charted airspace boundaries](https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Boundary_Airspace/FeatureServer)

### Read the radar scope

The scope uses a black background and subdued map lines, inspired by terminal controller displays. [FAA terminal display colors, table 1](https://www.faa.gov/about/office_org/headquarters_offices/avs/offices/aam/cami/library/online_libraries/aerospace_medicine/media/77013530.pdf#page=17)

The selected range sets the outer ring and map zoom. Aircraft can appear outside the ring if they are visible in the rectangular scope. The **Radar** header and **Traffic** summary each show the number of aircraft on the scope and the number inside the selected ring. To cover the visible area, Airwatch can request live positions up to 250 nautical miles from the scope center, depending on feed coverage.

Orange markers show operational U.S. public-use airports throughout the visible scope, including outside the outer ring. Airport identifiers appear where there is room for the label. The airport data is bundled for offline use. [FAA airport data](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/2026-10-29/)

- Tap **Data Blocks** to show or hide labels for surrounding traffic. The selected aircraft keeps its block. Each block stays on the same side of the target between updates when there is room. Airwatch repositions blocks to avoid collisions or scope edges and hides surrounding blocks when no position fits. A short leader line connects each block to its target and angles away from the one-minute vector when space permits. [FAA STARS handbook](https://www.faa.gov/documentLibrary/media/Order/JO%206191.3.pdf)
- In **Settings → Monitoring location**, **Label Outline Opacity** adjusts the borders around all aircraft labels and defaults to 70%. **Label Background Opacity** adjusts the black fill behind those labels and defaults to 90%. Both sliders move in 10% steps from 0% to 100% and update the sample label on the **Radar preview** as you move them. Tap **Save settings** to apply them to the main scope.
- A block shows the aircraft identifier, then altitude MSL, vertical trend, and ground speed. `124 ↓ 340KT` means 12,400 feet MSL, descending, at 340 knots. `GND` marks a ground target. `SQ 0453 · B738` shows the squawk and aircraft type. Airwatch prefers ADS-B barometric pressure altitude as an MSL estimate and uses geoid-corrected geometric altitude when only geometric altitude is available. The crew’s selected altitude and the controller’s assigned altitude are separate values. [FAA ADS-B altitude reports](https://www.faa.gov/air_traffic/technology/equipadsb/resources/faq) · [FAA STARS procedures](https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap5_section_14.html)
- Use the **Color** chooser in the Radar header to color aircraft by altitude, ground speed, or squawk. Airwatch saves the selection in the browser profile. The legend below **Nearby aircraft** shows all three color keys, with altitude in hundreds of feet and flight-level notation for whole-hundred cutoffs at or above FL180. In **Settings → Color Settings**, tap a swatch to choose a preset color or enter new altitude and ground speed cutoffs. **Save settings** applies the changes to Radar, Nearby aircraft, and Traffic. Each data block uses one text color that matches its target. The selected aircraft is white, and reported emergencies show a red `!` beside the target.
- By default, **Squawk** mode uses green for `1200`, red for `7500`, `7600`, and `7700`, and blue for other reported codes. The squawk columns in Nearby aircraft and Traffic use the configured colors in every mode.
- **History dots** show up to four previous positions per visible target by default. Tap a target or its Nearby aircraft row to highlight its full retained trail. Tap open space to clear the selection. Airwatch builds a trail for each aircraft reported during the current browser session. Older dots are dimmer, and a repeated cached update leaves the trail unchanged. A trail expires after 20 minutes without a fresh position from that aircraft. [EUROCONTROL radar display reference, Track History](https://www.eurocontrol.int/archive_download/all/node/10206#page=15)
- The default **Altitude** colors are dark blue for ground traffic and cyan for airborne traffic below 1,200 feet. Green covers 1,200 to below 10,000 feet, yellow covers 10,000 to below 18,000 feet, red covers 18,000 to below 40,000 feet, and violet covers 40,000 feet and above. Aircraft without an altitude appear gray. Airport marks and labels are orange.
- The default **Speed** colors are dark blue for ground traffic, then cyan below 100 knots, green from 100 to 199, yellow from 200 to 299, red from 300 to 399, and violet from 400 up. Missing airborne speeds appear gray.
- Below 18,000 feet MSL, altitude colors use the estimated height above the radar center, so the 1,200-foot cutoff is relative to the scope elevation. At 18,000 feet MSL and higher, colors use MSL. If no terrain elevation is available for the scope center, AGL stays blank and colors use MSL at all altitudes. AGL can be negative when a target is below the scope center’s elevation. [NOAA ETOPO global relief model](https://www.ncei.noaa.gov/products/etopo-global-relief-model)
- Tap **1-min Vectors** for a one-minute projection from each eligible aircraft’s reported position along its true ground track at its current ground speed. The arrowhead marks the projected position. At 300 knots the line spans 5 nautical miles. A vector requires a moving airborne target and a current feed position no more than 60 seconds old. Tap a target to see **Ground Track** and **Position Age** in its details when the feed supplies them. [EUROCONTROL radar display reference, section 4.4.7](https://www.eurocontrol.int/archive_download/all/node/10206)

### Show weather radar

On **Radar**, tap **Weather** to show or hide the U.S. Mosaic. It combines NEXRAD base reflectivity across the contiguous United States, and Airwatch checks for new imagery about every five minutes. [IEM NEXRAD Mosaic](https://mesonet.agron.iastate.edu/docs/nexrad_composites/)

In **Settings → Minimum dBZ**, choose **Off** to show all returns or select a cutoff from 0 to 75 dBZ in steps of 5. Tap **Save settings** to hide returns below that cutoff. Returns at the cutoff stay visible, and Airwatch remembers the setting. [IEM reflectivity lookup table](https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=2)

## Live traffic

In **Settings**, choose a named provider under **Source** and tap **Save settings**. The browser keeps your existing Demo or provider choice. An older Live setting without a named provider uses the local receiver if configured, or adsb.lol otherwise. Settings marks unavailable providers **(setup required)** and shows how to enable them. Aircraft counts depend on coverage, and the status display indicates stale or unavailable data.

| Provider | Default refresh | Setup and terms |
| --- | ---: | --- |
| **adsb.lol** | 180 seconds | Works without a key. `ADSB_LOL_API_KEY` is optional. [API documentation](https://www.adsb.lol/docs/open-data/api) · [Data license](https://www.adsb.lol/docs/privacy-license) |
| **adsb.fi** | 15 seconds | Works without a key for personal, noncommercial use. Provider information is linked under **Settings → Traffic Feed**. [API documentation and terms](https://github.com/adsbfi/opendata/blob/main/README.md) |
| **FlyItalyADSB** | 10 seconds | Set `FLYITALYADSB_API_KEY` on the server. Plan limits apply to all requests using the same key. [Plans and API key](https://flyitalyadsb.com/data/api/) · [Data license and terms](https://flyitalyadsb.com/terms/) |
| **Local receiver** | 5 seconds | Set `FLIGHT_TRACK_LIVE_URL` to your receiver’s `aircraft.json` URL. |

The browser checks the local Airwatch server every five seconds in Live mode. The server refreshes the upstream data at the selected provider’s cadence. **Age** shows the time since the last traffic update. To change the adsb.lol refresh interval, set `FLIGHT_TRACK_REMOTE_INTERVAL_SECONDS`. The supported range is 180–3,600 seconds without an API key or 15–3,600 seconds with a key. Choose an interval within your provider quota.

### Configure a FlyItalyADSB key

On Windows, enter the key at the masked PowerShell prompt before starting the server.

```powershell
$flyItalyKey = Read-Host 'FlyItalyADSB API key' -AsSecureString
$env:FLYITALYADSB_API_KEY = [System.Net.NetworkCredential]::new('', $flyItalyKey).Password
node server.mjs
```

On the Pi, add `FLYITALYADSB_API_KEY=your-key` to the kiosk user’s `~/.config/flight-track/server.env`, replacing `your-key` with your key. Restrict the file to your user with `chmod 600 ~/.config/flight-track/server.env`, then run `systemctl --user restart flight-track.service` and refresh the kiosk. Keep the key in the server environment and out of browser settings and project files.

### Squawk

- **Squawk** is the aircraft’s four-digit Mode A transponder code. Aircraft Details and both aircraft lists display it. [FAA Aeronautical Information Manual](https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_1.html)

A passive receiver can pick up TIS-B broadcasts meant for nearby qualifying aircraft. The FAA selects targets within 15 nautical miles and 3,500 feet above or below those aircraft, so the resulting view around the receiver is partial. FIS-B broadcasts weather and aeronautical information on 978 MHz UAT. Receiving and decoding FIS-B would require a 978 MHz UAT receiver and decoder. Airwatch’s **Weather** layer uses internet NEXRAD imagery. [FAA TIS-B coverage](https://www.faa.gov/air_traffic/technology/adsb/pilot) · [FAA FIS-B](https://www.faa.gov/air_traffic/technology/equipadsb/capabilities/ins_outs)

### Use a local receiver

If you run readsb or tar1090, point the server to your receiver’s `aircraft.json` endpoint for updates every five seconds. Set the environment variable before starting the server on Windows. Replace the example URL with the address and path served by your receiver.

```powershell
$env:FLIGHT_TRACK_LIVE_URL = 'http://127.0.0.1/tar1090/data/aircraft.json'
node server.mjs
```

On the Pi, add `FLIGHT_TRACK_LIVE_URL=http://127.0.0.1/tar1090/data/aircraft.json` to `~/.config/flight-track/server.env` with your receiver’s URL and restart the user service. Select **Local receiver** under **Source** in Settings and tap **Save settings**.

For a Pi receiver, a USB SDR with a vertically mounted 1090 MHz antenna can receive 1090ES traffic. A clear view of the sky and a short, low-loss antenna cable help reception. Buildings, terrain, and low aircraft altitude can limit the view. [FlightAware receiver and antenna guidance](https://www.flightaware.com/adsb/piaware/build/optional)

## Raspberry Pi kiosk setup

These steps use **64-bit Raspberry Pi OS with Desktop** and its labwc session. Attach the display and its touch-data connection. In **Preferences → Control Centre → Screens**, select **1920 × 1200**, landscape orientation, and **1.0×** scaling. In **Display**, turn off **Screen Blanking** for an always-on display. In **System**, choose desktop startup and enable **Desktop Auto Login** for the kiosk account if you want Airwatch to appear at power-on. [Raspberry Pi display and startup settings](https://www.raspberrypi.com/documentation/computers/configuration.html)

### Connect Wi-Fi and SSH

For a fresh system, set the hostname, user, Wi-Fi, and SSH in Raspberry Pi Imager. On an existing desktop, use the network icon to join Wi-Fi. From a terminal you can list networks and connect with the commands below. NetworkManager prompts for the Wi-Fi password. Use the local display or Ethernet when changing the Wi-Fi connection that carries your SSH session. [Raspberry Pi first boot](https://www.raspberrypi.com/documentation/computers/getting-started.html) · [Raspberry Pi networking](https://www.raspberrypi.com/documentation/computers/configuration.html)

```sh
nmcli dev wifi list
sudo nmcli --ask dev wifi connect "Your network name"
nmcli dev status
```

On the same network, connect from Windows PowerShell with `ssh radar@radar.local` if you configured the `radar` account and hostname. Substitute your account and hostname, or use the Pi’s IP address if `.local` resolution is unavailable. [Raspberry Pi SSH setup](https://www.raspberrypi.com/documentation/computers/remote-access.html)

### Install and launch Airwatch

1. Install the required packages from a Pi terminal. Check that the Node version is at least 20. If an older Pi OS image provides an older Node, use the 64-bit Node.js distribution for ARM or update the OS. The service example below assumes `/usr/bin/node`. Set `ExecStart` to your actual Node path if you installed Node elsewhere. [Node.js ARM downloads](https://nodejs.org/en/download) · [Debian Trixie Node.js package](https://packages.debian.org/trixie/nodejs)

   ```sh
   sudo apt update
   sudo apt install nodejs chromium curl
   node --version
   ```

2. Copy the project contents into `~/.local/share/flight-track` on the Pi, keeping the folder structure. The runtime needs `server.mjs`, `terrain.mjs`, `geoid.mjs`, `package.json`, and the `data`, `public`, and `deploy` directories. Install and start the included user service under the same account that signs in to the desktop.

   ```sh
   cd ~/.local/share/flight-track
   mkdir -p ~/.config/systemd/user ~/.config/flight-track ~/.config/labwc
   install -m 644 deploy/flight-track.service ~/.config/systemd/user/flight-track.service
   systemctl --user daemon-reload
   systemctl --user enable --now flight-track.service
   curl --head --fail http://127.0.0.1:8080/
   ```

3. Start the included Chromium launcher once from a terminal in the Pi’s graphical desktop. Try a tab tap, a horizontal swipe, and a marker tap. If using adsb.fi, open **Settings**, choose **adsb.fi** under **Source**, and tap **Save settings**. The kiosk has its own Chromium profile, so save your preferences there. Press **Alt+F4** to close it when you finish testing.

   ```sh
   sh ~/.local/share/flight-track/deploy/start-kiosk.sh
   ```

4. Open `~/.config/labwc/autostart` in a text editor and append this line to start Chromium each time the desktop session starts. Sign out and back in to verify it. [Official Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/)

   ```sh
   sh "$HOME/.local/share/flight-track/deploy/start-kiosk.sh" &
   ```

### Enter numbers on the touchscreen

The Pi launcher enables Airwatch’s built-in numeric keypad. In **Settings**, pick **Custom coordinates** to edit **Latitude** and **Longitude**, or tap an altitude or speed cutoff under **Color Settings**. Coordinates accept signed decimals, altitude cutoffs accept signed whole numbers, and speed cutoffs accept nonnegative whole numbers. **Clear** erases the entry, **⌫** deletes one character, and **Cancel** closes it without applying the edit. Tap **Done** to apply the field and **Save settings** to save the form. On Windows, open [Airwatch with the keypad enabled](http://127.0.0.1:8080/?coordinate-keypad=1) to try it.

### Pi maintenance

- If Chromium opens to a connection error or the screen stays at the desktop, check `systemctl --user status flight-track.service --no-pager`, then `journalctl --user -u flight-track.service -n 50 --no-pager`. Test the local page with `curl --head --fail http://127.0.0.1:8080/`. If the page responds, try the launcher from the desktop terminal and check `~/.config/labwc/autostart` for the launcher line.
- If Live is stale or unavailable, check that the selected source is reachable and any key or receiver URL is configured. Switch to **Demo** to test the scope and controls offline. Some sources cover fewer aircraft than others, and a live feed can return no aircraft within the scope.
- If the numeric keypad is missing, start the kiosk with the included launcher and check that **Scope Center** is set to **Custom coordinates** for coordinate entry. For text fields such as **Location name**, use a physical keyboard if the desktop on-screen keyboard is unavailable.
- The launcher uses Chromium’s `--password-store=basic` for its dedicated kiosk profile so unattended startup does not prompt to unlock the desktop keyring for browser password storage. Keep saved website credentials out of the kiosk profile. If a keyring prompt returns, verify that the current launcher is the one used by labwc and check the command for the same flag. [Chromium Linux password storage](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/password_storage.md)
- After changing `server.env` or updating the project files, run `systemctl --user restart flight-track.service` and refresh the kiosk page. Close and reopen Chromium using the launcher if it changed. Keep the kiosk profile at `~/.local/state/flight-track/chromium` and the optional server configuration at `~/.config/flight-track/server.env` to retain settings across upgrades.
- The server defaults to `127.0.0.1:8080`. If you change `PORT` in the service environment, set `FLIGHT_TRACK_KIOSK_URL` to the matching loopback URL on the launcher line in `autostart`.
- To return to regular desktop startup, remove the launcher line from `~/.config/labwc/autostart` and run `systemctl --user disable --now flight-track.service`.

## Data sources and credits

- The offline map uses Natural Earth data. The airport and airspace files use FAA data, and scope-center terrain elevation comes from NOAA ETOPO. [Bundled map and terrain sources](../public/geo/SOURCES.md) · [Leaflet license](../public/vendor/leaflet/LICENSE)
- The online map and weather layers use USGS imagery, FAA charts, and the Iowa Environmental Mesonet’s NEXRAD mosaic. [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) · [FAA digital products](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/) · [IEM NEXRAD Mosaic](https://mesonet.agron.iastate.edu/docs/nexrad_composites/)
- Live traffic comes from the provider selected in **Source**. See the [live traffic table](#live-traffic) for terms and refresh intervals.
