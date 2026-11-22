import { DEFENSE_ITEMS, ShopItemId, Tank, WEAPONS, WeaponId } from '@tankwars/shared';

const DESC: Record<string, string> = {
  MISSILE: 'Größerer Krater, mehr Schaden.',
  MIRV: 'Teilt sich am Scheitelpunkt in 5 Sprengköpfe.',
  NUKE: 'Vernichtender Radius. Zerlegt ganze Hügel.',
  DIRT_BALL: 'Schüttet Erde auf – begrabe Gegner!',
  MARK_II: 'Doppelte Größe der Standard-Brandbombe.',
  NUKE_5M: 'Löscht bis zu 7 Panzer auf einmal aus.',
  CRI_S: 'Kettenreaktion im Boden – kurze Reichweite.',
  CRI_D: 'Fließende Kettenreaktion – frisst sich breit durchs Gelände.',
  CRI_ND: 'Zähe Kettenreaktion – gräbt tief in die Erde.',
  SONIC: 'Lässt alles lose Erdreich einstürzen – Panzer fallen ab.',
  EXPLOSIVE_DIRT: 'Schleudert Erde in die Luft, die wieder herabrieselt.',
  LASER: 'Sofort-Strahl in Zielrichtung. Die Kraft bestimmt den Schaden.',
  GUIDED_H: 'Steuert im Flug seitlich auf den Gegner zu.',
  GUIDED_V: 'Stürzt senkrecht auf den Gegner herab.',
  SHIELD: 'Absorbiert Schaden, bevor deine Panzerung leidet.',
  PARACHUTE: 'Bremst Stürze nach Erdrutschen ab.',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface ShopContext {
  round: number;
  canAdvance: boolean;
  standings: Tank[];
}

export class ShopOverlay {
  private el: HTMLDivElement;
  public isOpen = false;
  private tank: Tank | null = null;
  private ctx: ShopContext | null = null;

  constructor(private onBuy: (itemId: ShopItemId) => void, private onNextRound: () => void) {
    this.el = document.createElement('div');
    this.el.id = 'shop';
    this.el.className = 'screen hidden';
    document.body.appendChild(this.el);
  }

  public show(tank: Tank, ctx: ShopContext): void {
    this.tank = tank;
    this.ctx = ctx;
    this.isOpen = true;
    this.el.classList.remove('hidden', 'out');
    this.render();
  }

  /** Aktualisiert Geld/Bestand ohne das Overlay neu einzublenden. */
  public refresh(tank: Tank): void {
    if (!this.isOpen) return;
    this.tank = tank;
    this.render();
  }

  public hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('out');
    setTimeout(() => {
      if (!this.isOpen) this.el.classList.add('hidden');
    }, 360);
  }

  private render(): void {
    const tank = this.tank!;
    const ctx = this.ctx!;
    const grid = this.el.querySelector('.shop-grid');
    const scroll = grid?.scrollTop ?? 0;

    const items: Array<{ id: string; name: string; price: number; owned: number; color: string; desc: string }> = [
      ...(Object.keys(WEAPONS) as WeaponId[])
        .filter((id) => WEAPONS[id].price > 0)
        .map((id) => ({
          id,
          name: `${WEAPONS[id].name} ×${WEAPONS[id].bundleSize}`,
          price: WEAPONS[id].price,
          owned: tank.inventory[id] || 0,
          color: WEAPONS[id].color,
          desc: DESC[id] || '',
        })),
      { id: 'SHIELD', name: DEFENSE_ITEMS.SHIELD.name, price: DEFENSE_ITEMS.SHIELD.price, owned: Math.round(tank.shield), color: '#4fd8ff', desc: DESC.SHIELD },
      { id: 'PARACHUTE', name: DEFENSE_ITEMS.PARACHUTE.name, price: DEFENSE_ITEMS.PARACHUTE.price, owned: tank.parachutes, color: '#f4f4f4', desc: DESC.PARACHUTE },
    ];

    const winner = ctx.standings.find((t) => t.alive);
    const results = [...ctx.standings]
      .sort((a, b) => b.score - a.score)
      .map(
        (t) =>
          `<div class="res ${winner && t.id === winner.id ? 'win' : ''}"><i style="background:${t.color}"></i>${esc(t.name)} · ${t.score}</div>`
      )
      .join('');

    this.el.innerHTML = `
      <div class="shop-wrap">
        <div class="shop-head">
          <div>
            <small>RUNDE ${ctx.round} BEENDET · ${winner ? `SIEGER: ${esc(winner.name).toUpperCase()}` : 'UNENTSCHIEDEN'}</small>
            <h2>WAFFENDEPOT</h2>
          </div>
          <div class="cash">$${tank.money.toLocaleString('de-DE')}</div>
        </div>
        <div class="results">${results}</div>
        <div class="shop-grid">
          ${items
            .map(
              (it) => `
            <button class="item" data-buy="${it.id}" ${tank.money < it.price ? 'disabled' : ''}>
              <div class="t"><i style="background:${it.color};color:${it.color}"></i>${it.name}</div>
              <div class="d">${it.desc}</div>
              <div class="f"><span>Bestand: ${it.owned}</span><span class="p">$${it.price}</span></div>
            </button>`
            )
            .join('')}
        </div>
        <div class="shop-foot">
          <span class="hint">${ctx.canAdvance ? 'Kaufe Ausrüstung und starte die nächste Runde.' : 'Der Host startet die nächste Runde…'}</span>
          ${ctx.canAdvance ? `<button id="shop-next" class="btn primary">Nächste Runde</button>` : ''}
        </div>
      </div>`;

    const newGrid = this.el.querySelector('.shop-grid');
    if (newGrid) newGrid.scrollTop = scroll;

    this.el.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => this.onBuy(btn.dataset.buy as ShopItemId));
    });
    this.el.querySelector('#shop-next')?.addEventListener('click', () => this.onNextRound());
  }
}
