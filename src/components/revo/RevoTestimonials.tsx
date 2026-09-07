"use client";

import { useEffect, useState } from "react";
import { formatINR, timeAgo } from "./lib";

interface Testimonial {
  name: string;
  flag?: string;
  package: string;
  method: string;
  amount: number;
  hours: number;
  text: string;
  rating: number;
  timestamp: number;
}

const METHOD_DOT: Record<string, string> = {
  UPI: "#448AFF",
  BKASH: "#e2136e",
  USDT: "#2ed573",
};

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <i
          key={i}
          className={`fas fa-star text-[10px] ${
            i < n ? "text-[#FFD700]" : "text-[#3a3f5c]"
          }`}
        />
      ))}
    </div>
  );
}

function Card({ t }: { t: Testimonial }) {
  const dot = METHOD_DOT[t.method] ?? "#448AFF";
  return (
    <div className="revo-card flex h-full flex-col p-5">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black text-white"
          style={{
            background: `linear-gradient(135deg, ${dot}, #2962FF)`,
          }}
        >
          {t.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-white">{t.name}</span>
            {t.flag && <span className="text-sm">{t.flag}</span>}
            <i className="fas fa-circle-check text-[10px] text-[#2ed573]" title="Verified purchase" />
          </div>
          <div className="flex items-center gap-1.5">
            <Stars n={t.rating} />
            <span className="text-[10px] text-[#5a6a99]">{timeAgo(t.timestamp)}</span>
          </div>
        </div>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-[#8899cc]">&ldquo;{t.text}&rdquo;</p>
      <div className="mt-3 flex items-center justify-between border-t border-[#1e2240] pt-2.5 text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold text-[#bcc6e0]">
          <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
          {t.package} · {t.method}
        </span>
        <span className="font-bold text-[#FFD700]">{formatINR(t.amount)}</span>
      </div>
    </div>
  );
}

export function RevoTestimonials() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/testimonials");
        const json: Testimonial[] = await res.json();
        if (active) setItems(json);
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const perPage = 3;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = items.slice(page * perPage, page * perPage + perPage);

  return (
    <section id="reviews" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-star" /> Verified Reviews
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            What our <span className="revo-gradient-gold">users say</span>
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[#8899cc]">
            Real reviews derived from verified approved payments on the Revo
            Fixer platform. Names masked for privacy.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="revo-card h-56 revo-shimmer" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="revo-card p-10 text-center text-sm text-[#5a6a99]">
            No verified reviews yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {current.map((t, i) => (
                <Card key={i} t={t} />
              ))}
              {/* fill last row with summary card if needed */}
              {current.length < perPage && (
                <div className="revo-card flex flex-col items-center justify-center p-5 text-center">
                  <div className="text-3xl font-black revo-gradient-gold">
                    {items.length}+
                  </div>
                  <div className="text-xs text-[#8899cc]">Verified reviews</div>
                  <div className="mt-2 flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <i key={i} className="fas fa-star text-xs text-[#FFD700]" />
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-[#5a6a99]">Average rating</div>
                </div>
              )}
            </div>

            {/* pagination dots */}
            {pages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                {Array.from({ length: pages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={`h-2 rounded-full transition-all ${
                      i === page
                        ? "w-8 bg-[#448AFF]"
                        : "w-2 bg-[#1e2240] hover:bg-[#448AFF]/50"
                    }`}
                    aria-label={`Page ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
