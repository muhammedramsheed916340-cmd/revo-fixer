"use client";

import type { AppSettings } from "@/lib/types";

export function RevoFooter({
  settings,
  onGo,
}: {
  settings: AppSettings | null;
  onGo: (id: string) => void;
}) {
  const year = new Date().getFullYear();
  const telegram = settings?.telegramLink;
  const email = settings?.supportEmail;
  const support = settings?.supportContact ?? "@RevoAgent";

  return (
    <footer
      id="support"
      className="relative z-10 mt-auto scroll-mt-20 border-t border-[#1e2240] bg-[#0a0b14]/80 backdrop-blur-xl"
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span
                className="grid h-10 w-10 place-items-center rounded-xl text-lg font-black text-white"
                style={{ background: "linear-gradient(135deg,#448AFF,#2962FF)" }}
              >
                <i className="fas fa-crown" />
              </span>
              <div>
                <div className="text-lg font-extrabold text-white">
                  REVO<span className="text-[#448AFF]"> FIXER</span>
                </div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#5a6a99]">
                  ⚡ Crazy Time Revo Fixer ⚡
                </div>
              </div>
            </div>
            <p className="mt-4 max-w-md text-sm text-[#8899cc]">
              Premium timed-access license keys, real-time signals &amp; priority
              support. Pay via UPI, Bkash or USDT. Built by{" "}
              <a
                href="https://t.me/RevoAgent"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#448AFF] hover:underline"
              >
                {support}
              </a>
              .
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={telegram ?? "https://t.me/+CNJHfpdP1ck0NDA1"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-[#1e2240] bg-[#141827] px-3 py-2 text-sm font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
              >
                <i className="fab fa-telegram text-[#29b6f6]" /> Telegram Channel
              </a>
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#1e2240] bg-[#141827] px-3 py-2 text-sm font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
                >
                  <i className="fas fa-envelope text-[#448AFF]" /> {email}
                </a>
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
              Navigate
            </div>
            <ul className="space-y-2 text-sm">
              {[
                { id: "home", label: "Home" },
                { id: "packages", label: "Packages" },
                { id: "recommender", label: "Picker" },
                { id: "compare", label: "Compare" },
                { id: "revenue", label: "Revenue" },
                { id: "converter", label: "Converter" },
                { id: "deposit", label: "Deposit" },
                { id: "payments", label: "Payments" },
                { id: "stats", label: "Live Stats" },
                { id: "reviews", label: "Reviews" },
                { id: "activity", label: "Activity" },
                { id: "faq", label: "FAQ" },
                { id: "terms", label: "Terms" },
                { id: "admin", label: "Admin" },
              ].map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => onGo(l.id)}
                    className="text-[#bcc6e0] transition hover:text-[#448AFF]"
                  >
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
              App status
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-3 text-[#bcc6e0]">
                Version
                <span className="font-bold text-white">
                  v{settings?.appVersion ?? "2.0.0"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 text-[#bcc6e0]">
                Maintenance
                <span
                  className={`font-bold ${
                    settings?.maintenanceMode ? "text-[#ffa502]" : "text-[#2ed573]"
                  }`}
                >
                  {settings?.maintenanceMode ? "On" : "Off"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 text-[#bcc6e0]">
                Force update
                <span
                  className={`font-bold ${
                    settings?.forceUpdate ? "text-[#ff4757]" : "text-[#2ed573]"
                  }`}
                >
                  {settings?.forceUpdate ? "Required" : "Not needed"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 text-[#bcc6e0]">
                USDT rate
                <span className="font-bold text-white">
                  ₹{(settings?.paymentSettings?.usdtRate ?? 94.14).toFixed(2)}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-[#1e2240] pt-5 text-center sm:flex-row sm:text-left">
          <div className="text-xs text-[#5a6a99]">
            © {year} Revo Fixer. Developer{" "}
            <a
              href="https://t.me/RevoAgent"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#448AFF] hover:underline"
            >
              @RevoAgent
            </a>
            . All data shown is live from the Revo Fixer platform.
          </div>
          <div className="flex items-center gap-3 text-[#5a6a99]">
            <a
              href={telegram ?? "https://t.me/+CNJHfpdP1ck0NDA1"}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              className="transition hover:text-[#29b6f6]"
            >
              <i className="fab fa-telegram text-lg" />
            </a>
            <a
              href="mailto:support@revofixer.com"
              aria-label="Email"
              className="transition hover:text-[#448AFF]"
            >
              <i className="fas fa-envelope text-lg" />
            </a>
            <a
              href="https://crazytimerevo.netlify.app/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Original site"
              className="transition hover:text-[#FFD700]"
            >
              <i className="fas fa-globe text-lg" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
