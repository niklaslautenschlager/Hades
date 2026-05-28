import { useState, useRef, useEffect } from "react";
import { X, Calculator as CalcIcon, History as HistoryIcon, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

interface Props {
  onClose: () => void;
}

interface HistoryEntry {
  expr: string;
  result: string;
}

// ─── Math evaluator ──────────────────────────────────────────────────────────
//
// Safely evaluate a math expression containing common scientific functions.
// Implemented as a small parser that builds an AST and evaluates it — avoids
// using eval() / Function() so we control the surface area.

type Token =
  | { type: "num"; value: number }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "ident"; value: string }
  | { type: "comma" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(") { tokens.push({ type: "lparen" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma" }); i++; continue; }
    if ("+-*/^%".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++; continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      // Optional exponent: 1e10, 2.5e-3
      if (j < input.length && (input[j] === "e" || input[j] === "E")) {
        j++;
        if (j < input.length && (input[j] === "+" || input[j] === "-")) j++;
        while (j < input.length && /[0-9]/.test(input[j])) j++;
      }
      tokens.push({ type: "num", value: parseFloat(input.slice(i, j)) });
      i = j; continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j; continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt,
  log: Math.log10, ln: Math.log, log2: Math.log2,
  exp: Math.exp, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  fact: (n: number) => {
    if (n < 0 || !Number.isInteger(n)) return NaN;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
  max: Math.max, min: Math.min,
  pow: Math.pow, mod: (a: number, b: number) => a % b,
};

interface Parser {
  pos: number;
  tokens: Token[];
}

function parseExpr(p: Parser): number { return parseAddSub(p); }

function parseAddSub(p: Parser): number {
  let left = parseMulDiv(p);
  while (p.pos < p.tokens.length) {
    const t = p.tokens[p.pos];
    if (t.type === "op" && (t.value === "+" || t.value === "-")) {
      p.pos++;
      const right = parseMulDiv(p);
      left = t.value === "+" ? left + right : left - right;
    } else break;
  }
  return left;
}

function parseMulDiv(p: Parser): number {
  let left = parsePower(p);
  while (p.pos < p.tokens.length) {
    const t = p.tokens[p.pos];
    if (t.type === "op" && (t.value === "*" || t.value === "/" || t.value === "%")) {
      p.pos++;
      const right = parsePower(p);
      if (t.value === "*") left = left * right;
      else if (t.value === "/") left = left / right;
      else left = left % right;
    } else break;
  }
  return left;
}

function parsePower(p: Parser): number {
  const left = parseUnary(p);
  if (p.pos < p.tokens.length) {
    const t = p.tokens[p.pos];
    if (t.type === "op" && t.value === "^") {
      p.pos++;
      const right = parsePower(p); // right-associative
      return Math.pow(left, right);
    }
  }
  return left;
}

function parseUnary(p: Parser): number {
  const t = p.tokens[p.pos];
  if (t && t.type === "op" && (t.value === "+" || t.value === "-")) {
    p.pos++;
    const v = parseUnary(p);
    return t.value === "-" ? -v : v;
  }
  return parseFactorial(p);
}

function parseFactorial(p: Parser): number {
  let v = parsePrimary(p);
  // Postfix factorial: 5!
  while (p.pos < p.tokens.length && p.tokens[p.pos].type === "op" && (p.tokens[p.pos] as any).value === "!") {
    p.pos++;
    v = FUNCTIONS.fact(v);
  }
  return v;
}

function parsePrimary(p: Parser): number {
  const t = p.tokens[p.pos];
  if (!t) throw new Error("Unexpected end of expression");

  if (t.type === "num") {
    p.pos++;
    return t.value;
  }
  if (t.type === "lparen") {
    p.pos++;
    const v = parseExpr(p);
    if (p.tokens[p.pos]?.type !== "rparen") throw new Error("Missing closing parenthesis");
    p.pos++;
    return v;
  }
  if (t.type === "ident") {
    p.pos++;
    const name = t.value.toLowerCase();
    if (p.tokens[p.pos]?.type === "lparen") {
      p.pos++;
      const args: number[] = [];
      if (p.tokens[p.pos]?.type !== "rparen") {
        args.push(parseExpr(p));
        while (p.tokens[p.pos]?.type === "comma") {
          p.pos++;
          args.push(parseExpr(p));
        }
      }
      if (p.tokens[p.pos]?.type !== "rparen") throw new Error("Missing closing parenthesis");
      p.pos++;
      const fn = FUNCTIONS[name];
      if (!fn) throw new Error(`Unknown function: ${name}`);
      return fn(...args);
    }
    if (name in CONSTANTS) return CONSTANTS[name];
    throw new Error(`Unknown identifier: ${name}`);
  }
  throw new Error("Unexpected token");
}

function evaluate(input: string): number {
  // Tokenize first; treat trailing `!` as factorial postfix via op token.
  // Replace `!` with op marker (only postfix usage supported)
  const massaged = input.replace(/!/g, " !"); // separate for tokenizer
  const rawTokens = tokenize(massaged);
  // Allow `!` to be a postfix op — convert from ident parser
  const tokens: Token[] = rawTokens.map((t) =>
    t.type === "ident" && t.value === "!" ? { type: "op", value: "!" } : t
  );
  const parser: Parser = { pos: 0, tokens };
  const result = parseExpr(parser);
  if (parser.pos !== tokens.length) throw new Error("Unexpected trailing tokens");
  return result;
}

// ─── UI ──────────────────────────────────────────────────────────────────────

const BUTTONS: { label: string; insert?: string; action?: "eq" | "clear" | "back" | "ans"; col?: number; className?: string }[][] = [
  [
    { label: "sin", insert: "sin(" },
    { label: "cos", insert: "cos(" },
    { label: "tan", insert: "tan(" },
    { label: "ln",  insert: "ln(" },
    { label: "log", insert: "log(" },
  ],
  [
    { label: "x²",  insert: "^2" },
    { label: "xʸ",  insert: "^" },
    { label: "√",   insert: "sqrt(" },
    { label: "π",   insert: "pi" },
    { label: "e",   insert: "e" },
  ],
  [
    { label: "7", insert: "7" },
    { label: "8", insert: "8" },
    { label: "9", insert: "9" },
    { label: "(", insert: "(" },
    { label: ")", insert: ")" },
  ],
  [
    { label: "4", insert: "4" },
    { label: "5", insert: "5" },
    { label: "6", insert: "6" },
    { label: "×", insert: "*" },
    { label: "÷", insert: "/" },
  ],
  [
    { label: "1", insert: "1" },
    { label: "2", insert: "2" },
    { label: "3", insert: "3" },
    { label: "+", insert: "+" },
    { label: "−", insert: "-" },
  ],
  [
    { label: "0", insert: "0" },
    { label: ".", insert: "." },
    { label: "!", insert: "!" },
    { label: "Ans", action: "ans" },
    { label: "=", action: "eq", className: "bg-accent text-surface font-semibold col-span-1" },
  ],
];

export default function Calculator({ onClose }: Props) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Live preview
    if (!expr.trim()) { setResult(""); setError(""); return; }
    try {
      const v = evaluate(expr);
      if (Number.isFinite(v)) {
        setResult(formatNumber(v));
        setError("");
      } else {
        setResult("");
        setError("");
      }
    } catch {
      setResult("");
      // Don't show error while typing
    }
  }, [expr]);

  function formatNumber(n: number): string {
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    return n.toPrecision(12).replace(/\.?0+$/, "");
  }

  function commit() {
    try {
      const v = evaluate(expr);
      if (!Number.isFinite(v)) throw new Error("Result is not finite");
      const formatted = formatNumber(v);
      setHistory((h) => [{ expr, result: formatted }, ...h].slice(0, 20));
      setExpr(formatted);
      setResult("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid expression");
    }
  }

  function insert(text: string) {
    setExpr((e) => e + text);
    inputRef.current?.focus();
  }

  function pressButton(btn: typeof BUTTONS[number][number]) {
    if (btn.action === "eq") return commit();
    if (btn.action === "clear") { setExpr(""); setResult(""); setError(""); return; }
    if (btn.action === "back") { setExpr((e) => e.slice(0, -1)); return; }
    if (btn.action === "ans") {
      const last = history[0];
      if (last) insert(last.result);
      return;
    }
    if (btn.insert) insert(btn.insert);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commit(); return; }
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 360, damping: 28 }}
      className="surface w-[320px] flex flex-col shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-elevated">
        <div className="flex items-center gap-2">
          <CalcIcon className="w-3.5 h-3.5 text-muted" />
          <span className="text-xs font-medium text-foreground-secondary">Calculator</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`p-1 rounded text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all
                       ${showHistory ? "text-foreground-secondary" : ""}`}
            title="History"
          >
            <HistoryIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-foreground-secondary hover:bg-surface-hover transition-all"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Display */}
      <div className="px-3 py-3 border-b border-border bg-surface">
        <input
          ref={inputRef}
          type="text"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter expression..."
          className="w-full bg-transparent text-right text-lg font-mono text-foreground outline-none border-none placeholder:text-muted/60"
        />
        <div className="text-right text-xs font-mono mt-1 min-h-[16px]">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : result ? (
            <span className="text-muted">= {result}</span>
          ) : (
            <span className="text-muted/40">&nbsp;</span>
          )}
        </div>
      </div>

      {/* Buttons or History */}
      {showHistory ? (
        <div className="max-h-[260px] overflow-y-auto p-2">
          {history.length === 0 ? (
            <p className="text-xs text-muted text-center py-6">No history yet.</p>
          ) : (
            <>
              <div className="flex items-center justify-between px-2 py-1 mb-1">
                <span className="text-xs font-medium text-muted uppercase tracking-wider">History</span>
                <button
                  onClick={() => setHistory([])}
                  className="text-xs text-muted hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>
              <div className="space-y-0.5">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => { setExpr(h.expr); setShowHistory(false); }}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-hover transition-colors"
                  >
                    <div className="text-xs text-muted font-mono truncate">{h.expr}</div>
                    <div className="text-sm text-foreground font-mono">= {h.result}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Quick actions row */}
          <div className="grid grid-cols-5 gap-1 p-2 pb-1 border-b border-border">
            <button
              onClick={() => { setExpr(""); setResult(""); setError(""); }}
              className="py-2 rounded-md text-xs font-medium text-red-400 hover:bg-red-950/30 transition-all"
            >
              C
            </button>
            <button
              onClick={() => setExpr((e) => e.slice(0, -1))}
              className="py-2 rounded-md text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover transition-all"
            >
              ⌫
            </button>
            <button
              onClick={() => insert("(")}
              className="py-2 rounded-md text-xs font-mono text-foreground-secondary hover:bg-surface-hover transition-all"
            >
              (
            </button>
            <button
              onClick={() => insert(")")}
              className="py-2 rounded-md text-xs font-mono text-foreground-secondary hover:bg-surface-hover transition-all"
            >
              )
            </button>
            <button
              onClick={() => insert("%")}
              className="py-2 rounded-md text-xs font-medium text-foreground-secondary hover:bg-surface-hover transition-all"
            >
              %
            </button>
          </div>

          {/* Main button grid */}
          <div className="p-2 grid grid-cols-5 gap-1">
            {BUTTONS.flatMap((row, ri) =>
              row.map((btn, ci) => (
                <button
                  key={`${ri}-${ci}`}
                  onClick={() => pressButton(btn)}
                  className={`py-2.5 rounded-md text-sm font-mono font-medium transition-all
                             ${btn.className
                               ? btn.className
                               : btn.action === "eq"
                               ? "bg-accent text-surface"
                               : /[0-9.]/.test(btn.label)
                               ? "bg-surface-elevated text-foreground hover:bg-surface-hover"
                               : "bg-surface-hover text-foreground-secondary hover:text-foreground hover:bg-surface-elevated"
                             }`}
                >
                  {btn.label}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
