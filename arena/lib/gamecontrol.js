// Keeping a running game in step with the arena: the runner pauses its game while the arena is paused (the pause file:
// a usage limit, low disk, or by hand) and resumes it once the file is gone, but only a game it paused itself.
/**
 * deps: { paused: bool (the pause file exists), status: the game's status, setStatus(action) -> Promise (owner API),
 *         pausedBy() -> Promise<string|null>, markPausedBy(reason|null) -> Promise }
 * Returns "paused", "resumed" or null.
 */
export async function syncPause({ paused, status, setStatus, pausedBy, markPausedBy }) {
  if (paused && status === "running") {
    await setStatus("pause");
    await markPausedBy("pause-file");
    return "paused";
  }
  if (!paused && status === "paused" && (await pausedBy())) {
    await setStatus("resume");
    await markPausedBy(null);
    return "resumed";
  }
  return null;
}
