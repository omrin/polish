"""Word-level diff. Same algorithm as extension/src/diff.js (keep them in sync)."""
import re
from dataclasses import dataclass

_TOKEN = re.compile(r"(\s+)")


@dataclass(frozen=True)
class DiffOp:
    op: str  # "equal" | "delete" | "insert"
    text: str


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.split(text) if t != ""]


def word_diff(a: str, b: str) -> list[DiffOp]:
    x, y = tokenize(a), tokenize(b)
    n, m = len(x), len(y)
    # LCS lengths of suffixes
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = dp[i + 1][j + 1] + 1 if x[i] == y[j] else max(dp[i + 1][j], dp[i][j + 1])

    ops: list[DiffOp] = []

    def push(op: str, text: str):
        if ops and ops[-1].op == op:
            ops[-1] = DiffOp(op, ops[-1].text + text)
        else:
            ops.append(DiffOp(op, text))

    i = j = 0
    while i < n and j < m:
        if x[i] == y[j]:
            push("equal", x[i]); i += 1; j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            push("delete", x[i]); i += 1
        else:
            push("insert", y[j]); j += 1
    while i < n:
        push("delete", x[i]); i += 1
    while j < m:
        push("insert", y[j]); j += 1
    return ops
