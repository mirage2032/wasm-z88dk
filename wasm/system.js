/**
 * zcc runs every tool with system(). In a browser there is no shell to give
 * the command to, so this hands it to the host instead (z88dk.mjs), which runs
 * the tool as a fresh WebAssembly instance and waits for it: a process. What it
 * returns is a wait status, as system() does: the exit code in bits 8-15.
 */
addToLibrary({
  _emscripten_system: (command) => {
    // system(NULL) asks whether there is a shell at all.
    if (!command) return 1;
    var run = Module['z88dkSystem'];
    if (!run) return -{{{ cDefs.ENOSYS }}};
    return run(UTF8ToString(command));
  },
});
