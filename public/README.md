# GaussianHelper — Setup & Execution Guide

GaussianHelper is a modern web application designed for preparing Gaussian Job Files (`.gjf`) and managing sequential batch job scripts for Windows (`.bcf`) and Linux (`.sh`).

Because modern browsers block ES modules and runtime dependencies from loading directly via local file directories (`file://` protocol) due to Cross-Origin Resource Sharing (CORS) security restrictions, you must run the app through a local web server.

We have packaged lightweight local launch scripts requiring **zero software installations**.

---

## 🚀 How to Launch the Application

### 💻 Windows
1. Extract the compressed folder (`dist.zip`).
2. Double-click the **`run.bat`** file.
   - *This starts a local server on port 8080 using PowerShell's built-in .NET network capabilities and automatically opens the app in your default web browser.*
3. Close the terminal window when you are finished to stop the server.

### 🐧 Linux
1. Extract the compressed folder (`dist.tar.gz` or `dist.zip`).
2. Open a terminal inside the extracted directory.
3. Run the launch helper:
   ```bash
   ./run.sh
   ```
   - *This boots a background HTTP server on port 8080 using your system's built-in Python module and opens the app automatically in your default system browser.*
4. Press `Ctrl+C` in your terminal to stop the server.

---

## 🛠️ Changing Port Settings
If port `8080` is currently in use by another application on your system, you can easily change it:
- **Windows**: Right-click `run.bat`, select *Edit*, and change the `$port = 8080;` value near the top of the file to a different port (e.g. `8085`).
- **Linux**: Edit `run.sh` in a text editor and change the `PORT=8080` line to your desired port number.

---

## 📄 License & Credits
* **Version**: v0.1-alpha
* **Developer**: xharl
* **License**: Released under the GNU General Public License v3 (GPLv3). See `LICENSE` for details.

