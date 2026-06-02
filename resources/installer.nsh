; ══════════════════════════════════════════════════════════════════════════════
;  EyesPro — Custom NSIS Installer Script
;  Injected by electron-builder via nsis.include
;  Compatible with NSIS 3.x + MUI2 (Modern UI 2)
; ══════════════════════════════════════════════════════════════════════════════

; ── Compile-time includes (script level) ──────────────────────────────────────
!include "WinVer.nsh"
!include "LogicLib.nsh"

; ── customHeader ──────────────────────────────────────────────────────────────
; Runs at the very top of the generated script — before any page definitions.
; Use this for !define overrides that MUI pages read at compile/init time.
!macro customHeader
  ; Branding strip at the bottom of every page
  BrandingText "EyesPro ${VERSION}  |  eyespro.app  |  © 2025–2026 المسار"

  ; ── Welcome page ────────────────────────────────────────────────────────────
  !define MUI_WELCOMEPAGE_TITLE "مرحباً بك في EyesPro ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT \
    "يقوم هذا المعالج بتثبيت EyesPro على جهازك.$\r$\n\
     $\r$\n\
     ◈  فترة تجريبية مجانية: 3 أيام كاملة من يوم التشغيل الأول$\r$\n\
     ◈  بعد انتهاء التجربة تحتاج إلى رمز تفعيل (سيريال)$\r$\n\
     ◈  للحصول على ترخيص دائم: eyespro.app$\r$\n\
     $\r$\n\
     يُنصح بإغلاق جميع التطبيقات الأخرى قبل المتابعة.$\r$\n\
     $\r$\n\
     انقر «التالي» للمتابعة."

  ; ── Finish page ─────────────────────────────────────────────────────────────
  !define MUI_FINISHPAGE_TEXT \
    "تم تثبيت EyesPro ${VERSION} بنجاح.$\r$\n\
     $\r$\n\
     ◈  لديك 3 أيام مجانية من اللحظة الأولى للتشغيل$\r$\n\
     ◈  للحصول على ترخيص دائم تفضّل بزيارة:$\r$\n\
          eyespro.app$\r$\n\
     $\r$\n\
     شكراً لاختيارك EyesPro."

  ; ── License page ────────────────────────────────────────────────────────────
  !define MUI_LICENSEPAGE_CHECKBOX
  !define MUI_LICENSEPAGE_CHECKBOX_TEXT \
    "لقد قرأت اتفاقية الترخيص وأوافق على جميع شروطها"
!macroend

; ── customInit ────────────────────────────────────────────────────────────────
; Runs inside .onInit — before the installer UI appears.
; Use for early sanity checks (OS version, architecture, etc.)
!macro customInit
  ; ── Require Windows 10 or newer ─────────────────────────────────────────────
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK \
      "EyesPro يتطلب Windows 10 أو إصدار أحدث.$\r$\n$\r$\nيرجى تحديث نظام التشغيل."
    Abort
  ${EndIf}

  ; ── Require 64-bit Windows ──────────────────────────────────────────────────
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK \
      "EyesPro يتطلب نظام Windows 64-بت.$\r$\nالنظام الحالي غير مدعوم."
    Abort
  ${EndIf}
!macroend

; ── customInstall ─────────────────────────────────────────────────────────────
; Runs at the end of the main install Section (files already copied).
!macro customInstall
  ; Record install metadata for diagnostics (trial is managed in-app via safeStorage)
  WriteRegStr   HKCU "Software\EyesPro" "Version"     "${VERSION}"
  WriteRegStr   HKCU "Software\EyesPro" "InstallPath" "$INSTDIR"

  ; ── Windows Firewall — allow outbound internet access ──────────────────────
  ; Without an explicit ALLOW rule, Windows Firewall silently blocks outbound
  ; connections from unsigned executables, which breaks all HTTP/HTTPS requests
  ; made by the Electron main process (sources fetch, AI, search, etc.).
  ;
  ; We delete any stale rule first to avoid duplicates on re-install, then add
  ; a fresh ALLOW rule for the outbound direction.  The inbound rule is added
  ; too so IPC-over-localhost (if ever used) is not blocked either.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="EyesPro" program="$INSTDIR\EyesPro.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="EyesPro" description="EyesPro desktop app" dir=out action=allow program="$INSTDIR\EyesPro.exe" enable=yes profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="EyesPro" description="EyesPro desktop app" dir=in  action=allow program="$INSTDIR\EyesPro.exe" enable=yes profile=any'
!macroend

; ── customUnInstall ───────────────────────────────────────────────────────────
; Runs at the start of the Uninstall Section.
!macro customUnInstall
  ; Remove firewall rules added during install
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="EyesPro" program="$INSTDIR\EyesPro.exe"'
  ; Remove registry keys written during install
  DeleteRegKey HKCU "Software\EyesPro"
!macroend
