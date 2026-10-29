import { cloneAnnotation } from './geometry.js';
import type { Annotation } from './types.js';

const HISTORY_LIMIT = 60;

/**
 * In-memory annotation list with a bounded undo/redo stack. Shapes are treated
 * as immutable; live drags replace an item without snapshotting so a whole
 * drag is one undo step.
 */
export class AnnotationStore {
  private items: Annotation[] = [];
  private undoStack: Annotation[][] = [];
  private redoStack: Annotation[][] = [];
  selectedId: string | null = null;
  onChange: (() => void) | null = null;

  get annotations(): readonly Annotation[] {
    return this.items;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get selected(): Annotation | null {
    return this.items.find((item) => item.id === this.selectedId) ?? null;
  }

  /** Snapshot the current state; call before a mutation that should be undoable. */
  commit() {
    this.undoStack.push(this.items.map(cloneAnnotation));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  add(annotation: Annotation) {
    this.commit();
    this.items = [...this.items, annotation];
    this.selectedId = annotation.id;
    this.emit();
  }

  replace(id: string, annotation: Annotation) {
    this.items = this.items.map((item) =>
      item.id === id ? annotation : item,
    );
    this.emit();
  }

  remove(id: string) {
    if (!this.items.some((item) => item.id === id)) return;
    this.commit();
    this.items = this.items.filter((item) => item.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.emit();
  }

  clear() {
    if (!this.items.length) return;
    this.commit();
    this.items = [];
    this.selectedId = null;
    this.emit();
  }

  select(id: string | null) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit();
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.items.map(cloneAnnotation));
    this.items = previous;
    if (
      this.selectedId &&
      !this.items.some((item) => item.id === this.selectedId)
    ) {
      this.selectedId = null;
    }
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.items.map(cloneAnnotation));
    this.items = next;
    if (
      this.selectedId &&
      !this.items.some((item) => item.id === this.selectedId)
    ) {
      this.selectedId = null;
    }
    this.emit();
  }

  private emit() {
    this.onChange?.();
  }
}
