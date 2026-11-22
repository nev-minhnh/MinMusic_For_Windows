; MinMusic NSIS installer hooks (Tauri 2 `bundle.windows.nsis.installerHooks`, included at the top of the template).
; Template hook points (tauri-bundler 2.10 installer.nsi):
;   NSIS_HOOK_PREINSTALL    first thing in `Section Install`, before CheckIfAppIsRunning and the file copy
;   NSIS_HOOK_POSTINSTALL   end of `Section Install`
;   NSIS_HOOK_PREUNINSTALL  first thing in `Section Uninstall`
;   NSIS_HOOK_POSTUNINSTALL end of `Section Uninstall`
; Per-user install (installMode currentUser): SHCTX = HKCU, no admin.
; All heavy logic lives in installer-helper.ps1 (extracted to $PLUGINSDIR for the installer; a copy is kept in
; $INSTDIR for the uninstaller, because the uninstaller cannot embed files).

!define MM_HELPER "installer-helper.ps1"
; __FILEDIR__ inside a macro expands at the use site (the generated installer.nsi), so capture it here
!define MM_HOOKDIR "${__FILEDIR__}"

; Run the helper with the given (already quoted) arguments. Output goes to the install log.
!macro MM_RUN_HELPER helperPath args
  nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${helperPath}" ${args}`
  Pop $R9
!macroend

; HKCU URL scheme registration
!macro MM_REGISTER_SCHEME scheme
  WriteRegStr HKCU "Software\Classes\${scheme}" "" "URL:${scheme}"
  WriteRegStr HKCU "Software\Classes\${scheme}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${scheme}\DefaultIcon" "" `"$INSTDIR\${MAINBINARYNAME}.exe",0`
  WriteRegStr HKCU "Software\Classes\${scheme}\shell\open\command" "" `"$INSTDIR\${MAINBINARYNAME}.exe" "%1"`
!macroend
; Remove the scheme only if it still points at our exe (never remove another app's registration).
!macro MM_UNREGISTER_SCHEME scheme
  ReadRegStr $R8 HKCU "Software\Classes\${scheme}\shell\open\command" ""
  ${If} $R8 == `"$INSTDIR\${MAINBINARYNAME}.exe" "%1"`
    DeleteRegKey HKCU "Software\Classes\${scheme}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Default install dir: %LOCALAPPDATA%\Programs\MinMusic. The template default for currentUser is
  ; $LOCALAPPDATA\MinMusic, which is also the user-data folder, so remap it (only when nothing was installed before
  ; and the path is still the template default; /D= and a previous install location are left alone).
  ReadRegStr $R0 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $R0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
  ${EndIf}
  SetOutPath $INSTDIR

  InitPluginsDir
  File `/oname=$PLUGINSDIR\${MM_HELPER}` `${MM_HOOKDIR}\${MM_HELPER}`
  ; 1. stop both MinMusic processes of THIS install dir (graceful, 3 s, then force; never by bare image name)
  !insertmacro MM_RUN_HELPER `$PLUGINSDIR\${MM_HELPER}` `-Action StopProcesses -InstallDir "$INSTDIR"`
  ; 2. uninstall the v1 MSI (per-user, silent). User data is kept (an MSI removes only its own files).
  !insertmacro MM_RUN_HELPER `$PLUGINSDIR\${MM_HELPER}` `-Action UninstallV1`
!macroend

!macro NSIS_HOOK_POSTINSTALL
  File `/oname=$INSTDIR\${MM_HELPER}` `${MM_HOOKDIR}\${MM_HELPER}`
  !insertmacro MM_REGISTER_SCHEME "minmusic"
  !insertmacro MM_REGISTER_SCHEME "metrolist"
  !insertmacro MM_REGISTER_SCHEME "metrolist-auth"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists `$INSTDIR\${MM_HELPER}` 0 +2
    !insertmacro MM_RUN_HELPER `$INSTDIR\${MM_HELPER}` `-Action StopProcesses -InstallDir "$INSTDIR"`
  !insertmacro MM_UNREGISTER_SCHEME "minmusic"
  !insertmacro MM_UNREGISTER_SCHEME "metrolist"
  !insertmacro MM_UNREGISTER_SCHEME "metrolist-auth"
  Delete `$INSTDIR\${MM_HELPER}`
  ; the core may write next to its files (class-data archive); the template only deletes what it installed
  RMDir /r `$INSTDIR\core`
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The template's "delete app data" checkbox ($DeleteAppDataCheckboxState, unticked by default) already removes
  ; %APPDATA%\<identifier> and %LOCALAPPDATA%\<identifier>. MinMusic keeps its data in ...\MinMusic: remove it too,
  ; but only when the box is ticked and this is not an update. Otherwise the user data is kept (U-4).
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\${PRODUCTNAME}"
    RmDir /r "$APPDATA\${PRODUCTNAME}"
  ${EndIf}
!macroend
