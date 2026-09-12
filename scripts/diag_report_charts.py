#!/usr/bin/env python3
"""Diagnostic report figures (English labels, DM-1 derived colors)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

PRIMARY = "#162235"; ACCENT = "#1B6B7A"; GRAY = "#90989F"; LIGHT = "#C8DDE2"; RED = "#B0413E"

plt.rcParams.update({"font.size": 10, "axes.edgecolor": "#D0D0D0",
                     "axes.labelcolor": PRIMARY, "text.color": PRIMARY,
                     "xtick.color": PRIMARY, "ytick.color": PRIMARY})

# ---------- Figure 1: benchmark comparison ----------
fig, ax = plt.subplots(figsize=(8.4, 4.2), dpi=220, constrained_layout=True)
labels = ["A. Current dynamic\n(stored, n=178)", "B. Experimental layer\n(retro simulation)", "C. Theoretical\n[1, 2, 5, 10]", "D. Random\nTop-4"]
vals = [66.29, 70.22, 85.96, 50.00]
cols = [ACCENT, LIGHT, PRIMARY, GRAY]
bars = ax.bar(labels, vals, color=cols, width=0.58, zorder=3)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width()/2, v + 1.2, f"{v:.2f}%", ha="center",
            fontsize=10.5, fontweight="bold", color=PRIMARY)
ax.axhline(83.33, color=RED, ls="--", lw=1.2, zorder=2)
ax.text(3.42, 84.4, "i.i.d. ceiling 83.33%", color=RED, fontsize=9, ha="right")
ax.set_ylim(0, 100)
ax.set_ylabel("Top-4 HIT rate (%)")
ax.set_title("Benchmark comparison on the same 178 unseen rounds", fontsize=12, fontweight="bold", pad=10)
ax.spines[["top", "right"]].set_visible(False)
ax.grid(axis="y", color="#E4E8EC", zorder=0)
fig.savefig("scripts/data/fig1_benchmarks.png")
plt.close(fig)

# ---------- Figure 2: inclusion vs actual vs prior ----------
fig, ax = plt.subplots(figsize=(8.4, 4.4), dpi=220, constrained_layout=True)
games = ["1", "2", "5", "10", "COIN FLIP", "PACHINKO", "CASH HUNT", "CRAZY TIME"]
incl = [88.8, 73.6, 54.5, 41.0, 42.1, 27.5, 39.3, 33.1]
act  = [41.6, 23.0, 13.5, 7.9, 6.7, 2.8, 2.8, 1.7]
prio = [38.89, 24.07, 12.96, 7.41, 7.41, 3.70, 3.70, 1.85]
x = np.arange(len(games)); w = 0.27
b1 = ax.bar(x - w, incl, w, label="Top-4 inclusion rate (stored)", color=ACCENT, zorder=3)
b2 = ax.bar(x,     act,  w, label="Actual occurrence rate", color=PRIMARY, zorder=3)
b3 = ax.bar(x + w, prio, w, label="Theoretical prior (54-segment wheel)", color=GRAY, zorder=3)
ax.set_xticks(x); ax.set_xticklabels(games, fontsize=9)
ax.set_ylabel("Share of rounds (%)")
ax.set_title("Bonus outcomes occupy 35.5% of Top-4 slots vs a 16.7% combined prior",
             fontsize=12, fontweight="bold", pad=10)
ax.legend(loc="upper right", frameon=False, fontsize=9)
ax.spines[["top", "right"]].set_visible(False)
ax.grid(axis="y", color="#E4E8EC", zorder=0)
ax.set_ylim(0, 100)
fig.savefig("scripts/data/fig2_slots.png")
plt.close(fig)
print("charts done")
