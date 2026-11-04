export type Sign = {
  cell: number;
  szTop: number;
  szBot: number;
  strikeCells: number[];
  interactive: boolean;
};

const INITIAL: Sign = {
  cell: 12,
  szTop: 3.5,
  szBot: 1.5,
  strikeCells: [6, 7, 8, 11, 12, 13, 16, 17, 18],
  interactive: false,
};

let sign: Sign = INITIAL;
let picker: (cell: number) => void = () => {};
const listeners = new Set<() => void>();

export function getSign(): Sign {
  return sign;
}

export function setSign(patch: Partial<Sign>): void {
  sign = { ...sign, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeSign(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 画面のゾーンを押したとき、配球パネルのコースを更新する。 */
export function setCellPicker(next: (cell: number) => void): void {
  picker = next;
}

export function pickCell(cell: number): void {
  picker(cell);
}
