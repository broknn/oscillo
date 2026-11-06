// Undo and redo over text snapshots of the setup. Comparing snapshots means no control has
// to report its own changes.
export class History {
  constructor(first, limit = 200) {
    this.now = first; this.limit = limit; this.past = []; this.future = [];
  }

  note(snapshot) {
    if (snapshot === this.now) return false;
    this.past.push(this.now);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.now = snapshot;
    return true;
  }

  // After restoring, the app may tidy the setup, and that mustn't count as a new change.
  sync(snapshot) { this.now = snapshot; }

  step(from, to) {
    if (!from.length) return null;
    to.push(this.now);
    this.now = from.pop();
    return this.now;
  }

  undo() { return this.step(this.past, this.future); }
  redo() { return this.step(this.future, this.past); }
}
