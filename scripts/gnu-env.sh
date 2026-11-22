# Source this for GNU-host builds on this PC (portable Rust + TDM-GCC).
# Rust's self-contained linker is used for LINKING (TDM-GCC 10.3 lacks libgcc_eh.a);
# TDM-GCC stays on PATH for compiling C code in build scripts and for windres.
source D:/Coding_Project/MinMusic-notes/tools/rust-env.sh
export PATH="/d/Coding_Project/MinMusic-notes/tools/rust/cargo/bin:/c/TDM-GCC-64/bin:$PATH"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="D:/Coding_Project/MinMusic-notes/tools/rust/rustup/toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained/x86_64-w64-mingw32-gcc.exe"
