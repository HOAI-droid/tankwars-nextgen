import { DEFENSE_ITEMS, ShopItemId, Tank, WEAPONS, WeaponId } from '@tankwars/shared';

export class ShopOverlay {
  private el: HTMLDivElement;

  constructor(private onBuy: (itemId: ShopItemId) => void, private onNextRound: () => void) {
    this.el = document.createElement('div');
    this.el.id = 'shop-overlay';
    this.el.className = 'hidden';
    this.el.style.cssText = `
      position:fixed; inset:0; z-index:30; background:rgba(10,14,22,0.88);
      backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; padding:16px;
    `;
    document.body.appendChild(this.el);
  }

  public show(tank: Tank, isHost = true): void {
    this.el.classList.remove('hidden');
    const weapons = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].price > 0);

    const rows = [
      ...weapons.map((id) => {
        const w = WEAPONS[id];
        return this.renderRow(id, `${w.name} (×${w.bundleSize})`, w.price, tank.money, tank.inventory[id] || 0);
      }),
      this.renderRow('SHIELD', DEFENSE_ITEMS.SHIELD.name, DEFENSE_ITEMS.SHIELD.price, tank.money, tank.shield),
      this.renderRow('PARACHUTE', DEFENSE_ITEMS.PARACHUTE.name, DEFENSE_ITEMS.PARACHUTE.price, tank.money, tank.parachutes),
    ].join('');

    this.el.innerHTML = `
      <div style="background:#1a2232; border:1px solid rgba(255,255,255,0.15); border-radius:16px; padding:20px; width:100%; max-width:440px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h2 style="margin:0; font-size:20px;">🛒 Waffen-Shop</h2>
          <span style="color:#4ade80; font-weight:700; font-size:18px;">$${tank.money}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">${rows}</div>
        ${
          isHost
            ? `<button id="shop-next" class="btn-fire" style="width:100%; margin-top:16px;">Nächste Runde starten →</button>`
            : `<p style="text-align:center; opacity:0.7; margin-top:14px;">Warte auf Host…</p>`
        }
      </div>
    `;

    this.el.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => this.onBuy(btn.dataset.buy as ShopItemId));
    });
    this.el.querySelector('#shop-next')?.addEventListener('click', () => {
      this.hide();
      this.onNextRound();
    });
  }

  public hide(): void {
    this.el.classList.add('hidden');
  }

  private renderRow(id: string, label: string, price: number, money: number, owned: number): string {
    const disabled = money < price ? 'disabled style="opacity:0.4;"' : '';
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#232d42; padding:8px 12px; border-radius:10px;">
        <div>
          <div style="font-weight:600; font-size:14px;">${label}</div>
          <div style="font-size:12px; opacity:0.7;">Im Besitz: ${owned}</div>
        </div>
        <button data-buy="${id}" ${disabled} style="background:#3b82f6; color:#fff; border:none; border-radius:8px; padding:6px 12px; font-weight:700; cursor:pointer;">
          $${price}
        </button>
      </div>
    `;
  }
}
