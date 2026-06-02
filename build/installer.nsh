; ── installer.nsh ─────────────────────────────────────────────────────────
;   NSIS Advanced Installer for EyesPro
;   Features: Firewall, Shortcuts, Trial Setup, Auto-Start
;──────────────────────────────────────────────────────────────────────────

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define PRODUCT_NAME "EyesPro"
!define COMPANY_NAME "Masar Network"
!define VERSION "1.0.0"
!define REG_KEY "Software\Masar\EyesPro"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Languages
!insertmacro MUI_LANGUAGE "Arabic"

; Sections
Section "EyesPro (مطلوب)" SEC_CORE
  SectionIn RO
  SetOutPath "$INSTDIR"
  
  ; Main files
  File /r "..\dist\win-unpacked\*"
  
  ; Registry
  WriteRegStr HKLM "${REG_KEY}" "InstallPath" "$INSTDIR"
  WriteRegStr HKLM "${REG_KEY}" "Version" "${VERSION}"
  WriteRegStr HKCU "${REG_KEY}" "TrialStart" ""
  
  ; Firewall - INTERNET ACCESS
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="EyesPro" dir=in action=allow program="$INSTDIR\EyesPro.exe" enable=yes'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="EyesPro" dir=out action=allow program="$INSTDIR\EyesPro.exe" enable=yes'
  
  ; Shortcuts
  CreateShortcut "$SMPROGRAMS\EyesPro.lnk" "$INSTDIR\EyesPro.exe"
  CreateShortcut "$DESKTOP\EyesPro.lnk" "$INSTDIR\EyesPro.exe"
  
  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Visual C++ Redist" SEC_VCREDIST
  File "vc_redist.x64.exe"
  ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart'
  Delete "$TEMP\vc_redist.x64.exe"
SectionEnd

Section "Auto-Start" SEC_AUTOSTART
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EyesPro" "$INSTDIR\EyesPro.exe"
SectionEnd

; Uninstaller
Section "Uninstall"
  ; Remove firewall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="EyesPro"'
  
  ; Remove shortcuts
  Delete "$SMPROGRAMS\EyesPro.lnk"
  Delete "$DESKTOP\EyesPro.lnk"
  
  ; Remove autostart
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EyesPro"
  
  ; Remove files
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${REG_KEY}"
SectionEnd
