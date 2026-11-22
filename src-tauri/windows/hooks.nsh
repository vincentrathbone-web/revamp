; RevAmp installer hooks: Explorer's "Play in RevAmp" / "Enqueue in RevAmp" entries (see src-tauri/src/shell.rs).
; Per user (HKCU), like the default install. --register keeps the user's earlier choices.

!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --register'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister'
!macroend
