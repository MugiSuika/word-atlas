import { Account } from "../auth/Account";
import { BackupControls } from "../auth/BackupControls";
import { useMemo } from "react";
import { useAtlas } from "../atlas/context";
import { isMastered } from "../store/srs";
import { dayKey, store, useStore, type Settings } from "../store/store";

import { streakOf } from "./Today";

export function Me({ privateAvailable }: { privateAvailable: boolean }) {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const settings = useStore((s) => s.settings);
  const locked = useStore((s) => s.locked);

  const stats = useMemo(() => {
    const cards = Object.values(progress.cards);
    const days = Object.values(progress.days);
    const r = days.reduce((n, d) => n + d.r, 0);
    const c = days.reduce((n, d) => n + d.c, 0);
    const t = days.reduce((n, d) => n + d.t, 0);
    const now = Date.now();
    const forecast = Array.from({ length: 7 }, (_, i) => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() + i);
      const start = new Date(end);
      start.setHours(0, 0, 0, 0);
      return cards.filter((x) =>
        i === 0
          ? x.due <= end.getTime()
          : x.due >= start.getTime() && x.due <= end.getTime(),
      ).length;
    });
    void now;
    return {
      learned: cards.length,
      mastered: cards.filter(isMastered).length,
      reviews: r,
      accuracy: r ? Math.round((c / r) * 100) : 0,
      minutes: Math.round(t / 60),
      forecast,
    };
  }, [progress]);

  const set = (patch: Partial<Settings>) => store.settings(patch);
  const maxF = Math.max(1, ...stats.forecast);

  return (
    <div className="page me">
      <header className="page-head">
        <p className="eyebrow">我的</p>
        <h1 className="display">你的星空</h1>
      </header>

      <Account />

      <section className="stat-strip">
        <div>
          <dt>连续学习</dt>
          <dd>
            {streakOf(progress.days)}
            <small>天</small>
          </dd>
        </div>
        <div>
          <dt>已点亮</dt>
          <dd>{stats.learned.toLocaleString()}</dd>
        </div>
        <div>
          <dt>长期记住</dt>
          <dd>{stats.mastered.toLocaleString()}</dd>
        </div>
        <div>
          <dt>首次正确率</dt>
          <dd>
            {stats.accuracy}
            <small>%</small>
          </dd>
        </div>
        <div>
          <dt>学习时长</dt>
          <dd>
            {stats.minutes}
            <small>分钟</small>
          </dd>
        </div>
      </section>

      <div className="me-grid">
        <section className="panel">
          <h3 className="eyebrow">过去 20 周</h3>
          <Heatmap days={progress.days} />
          <p className="muted">
            一格是一天，颜色越深，那天答得越多。「长期记住」指记忆稳定度超过 21
            天。
          </p>
        </section>

        <section className="panel">
          <h3 className="eyebrow">未来 7 天的复习量</h3>
          <ol className="forecast">
            {stats.forecast.map((n, i) => (
              <li key={i}>
                <span style={{ height: `${(n / maxF) * 100}%` }} />
                <b>{n}</b>
                <small>{i === 0 ? "今天" : i === 1 ? "明天" : `+${i}`}</small>
              </li>
            ))}
          </ol>
        </section>

        <fieldset className="panel settings" disabled={locked}>
          <h3 className="eyebrow">学习设置</h3>
          <Field label="每日新词" hint="复习不设上限，算法只安排快要遗忘的词。">
            <div className="segmented">
              {[5, 10, 15, 20, 30].map((n) => (
                <button
                  key={n}
                  className={settings.dailyNew === n ? "is-on" : ""}
                  onClick={() => set({ dailyNew: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="从哪个难度开始" hint="跳过已经熟悉的低级别词。">
            <div className="segmented">
              {atlas.cefr.map((l, i) => (
                <button
                  key={l}
                  className={settings.startLevel === i ? "is-on" : ""}
                  onClick={() => set({ startLevel: i })}
                >
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label="目标记忆率"
            hint="越高复习越频繁。90% 是大多数人的甜点。"
          >
            <div className="segmented">
              {[0.85, 0.9, 0.95].map((n) => (
                <button
                  key={n}
                  className={settings.retention === n ? "is-on" : ""}
                  onClick={() => set({ retention: n })}
                >
                  {Math.round(n * 100)}%
                </button>
              ))}
            </div>
          </Field>
          <Field label="发音">
            <div className="segmented">
              <button
                className={settings.accent === "uk" ? "is-on" : ""}
                onClick={() => set({ accent: "uk" })}
              >
                英式
              </button>
              <button
                className={settings.accent === "us" ? "is-on" : ""}
                onClick={() => set({ accent: "us" })}
              >
                美式
              </button>
            </div>
          </Field>
          <Field label="外观">
            <div className="segmented">
              {(
                [
                  ["system", "跟随系统"],
                  ["light", "浅色"],
                  ["dark", "深色"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={settings.theme === k ? "is-on" : ""}
                  onClick={() => set({ theme: k })}
                >
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Toggle
            label="自动播放发音"
            on={settings.autoplay}
            set={(v) => set({ autoplay: v })}
          />
          <Toggle
            label="界面音效"
            on={settings.sfx}
            set={(v) => set({ sfx: v })}
          />
          <Toggle
            label="开屏动画（每天一次）"
            on={settings.splash}
            set={(v) => set({ splash: v })}
          />
          <Toggle
            label="复习时加入拼写题"
            on={settings.spell}
            set={(v) => set({ spell: v })}
          />
          {privateAvailable && (
            <Field
              label="词库"
              hint="私人词库只在本机开发服务器中可用，不会被打包发布。"
            >
              <div className="segmented">
                <button
                  className={settings.dataset === "open" ? "is-on" : ""}
                  onClick={() => set({ dataset: "open" })}
                >
                  开放图鉴
                </button>
                <button
                  className={settings.dataset === "private" ? "is-on" : ""}
                  onClick={() => set({ dataset: "private" })}
                >
                  私人 8000
                </button>
              </div>
            </Field>
          )}
        </fieldset>

        <BackupControls />
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <div>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  on,
  set,
}: {
  label: string;
  on: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <label className="field toggle">
      <b>{label}</b>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => set(e.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function Heatmap({ days }: { days: Record<string, { r: number }> }) {
  const weeks = 20;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (weeks * 7 - 1) - end.getDay());
  const cells: { k: string; v: number; future: boolean }[] = [];
  const d = new Date(start);
  for (let i = 0; i < (weeks + 1) * 7; i++) {
    const k = dayKey(d);
    cells.push({ k, v: days[k]?.r ?? 0, future: d > end });
    d.setDate(d.getDate() + 1);
  }
  const lvl = (v: number) =>
    v === 0 ? 0 : v < 10 ? 1 : v < 25 ? 2 : v < 50 ? 3 : 4;
  return (
    <div className="heatmap" role="img" aria-label="学习热力图">
      {cells.map((c) => (
        <span
          key={c.k}
          className={`h${c.future ? "x" : lvl(c.v)}`}
          title={`${c.k} · ${c.v} 题`}
        />
      ))}
    </div>
  );
}
