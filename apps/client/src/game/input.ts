import { Buttons } from '@tactical/shared';

export interface KeybindMap {
  forward: string; back: string; left: string; right: string;
  jump: string; crouch: string; walk: string; use: string; reload: string;
  drop: string; inspect: string; slotPrimary: string; slotSecondary: string;
  slotKnife: string; slotGrenade: string; scope: string; buyMenu: string;
  scoreboard: string; teamChat: string; allChat: string; radio: string;
  toggleConsole: string; debugOverlay: string; pushToTalk: string;
}

export interface InputState {
  forward: number;
  right: number;
  yaw: number;
  pitch: number;
  buttons: number;
  grenadeSlot: number;
}

export class InputManager {
  readonly keys = new Set<string>();
  readonly mouse = { dx: 0, dy: 0, left: false, right: false };
  sensitivity = 2.2;
  zoomSensitivity = 0.8;
  invertY = false;
  scoped = false;
  enabled = false;
  yaw = 0;
  pitch = 0;
  grenadeSlot = 0;
  keybinds: KeybindMap;
  onPointerLockChange?: (locked: boolean) => void;
  onKeyAction?: (action: string) => void;
  private readonly canvas: HTMLCanvasElement;
  private lastToggle: Record<string, boolean> = {};
  private wheelAccum = 0;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;
  private readonly boundKeyUp: (e: KeyboardEvent) => void;
  private readonly boundMouseMove: (e: MouseEvent) => void;
  private readonly boundMouseDown: (e: MouseEvent) => void;
  private readonly boundMouseUp: (e: MouseEvent) => void;
  private readonly boundWheel: (e: WheelEvent) => void;
  private readonly boundContext: (e: Event) => void;
  private readonly boundLockChange: () => void;

  constructor(canvas: HTMLCanvasElement, keybinds: KeybindMap) {
    this.canvas = canvas;
    this.keybinds = keybinds;
    this.boundKeyDown = (e) => this.keyDown(e);
    this.boundKeyUp = (e) => this.keyUp(e);
    this.boundMouseMove = (e) => this.mouseMove(e);
    this.boundMouseDown = (e) => this.mouseDown(e);
    this.boundMouseUp = (e) => this.mouseUp(e);
    this.boundWheel = (e) => this.wheel(e);
    this.boundContext = (e) => e.preventDefault();
    this.boundLockChange = () => this.onPointerLockChange?.(document.pointerLockElement === this.canvas);
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
    window.addEventListener('wheel', this.boundWheel, { passive: true });
    this.canvas.addEventListener('contextmenu', this.boundContext);
    document.addEventListener('pointerlockchange', this.boundLockChange);
  }

  requestLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  get locked(): boolean { return document.pointerLockElement === this.canvas; }

  private keyDown(e: KeyboardEvent): void {
    if (e.code === 'Tab' && this.enabled) e.preventDefault();
    if (e.code === this.keybinds.toggleConsole || e.code === this.keybinds.debugOverlay) {
      this.onKeyAction?.(e.code === this.keybinds.toggleConsole ? 'console' : 'debug');
    }
    if (this.enabled && document.pointerLockElement === this.canvas && ['Space', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (!this.enabled) return;
    if (e.code === this.keybinds.buyMenu) this.onKeyAction?.('buy');
    if (e.code === this.keybinds.scoreboard) this.onKeyAction?.('scoreboard_on');
    if (e.code === this.keybinds.teamChat) this.onKeyAction?.('chat_team');
    if (e.code === this.keybinds.allChat) this.onKeyAction?.('chat_all');
    if (e.code === this.keybinds.radio) this.onKeyAction?.('radio');
    if (e.code === 'Escape') this.onKeyAction?.('pause');
  }

  private keyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.code === this.keybinds.scoreboard) this.onKeyAction?.('scoreboard_off');
  }

  private mouseMove(e: MouseEvent): void {
    if (!this.enabled || document.pointerLockElement !== this.canvas) return;
    const sens = 0.00042 * this.sensitivity * (this.scoped ? this.zoomSensitivity : 1);
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens * (this.invertY ? -1 : 1);
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  private mouseDown(e: MouseEvent): void {
    if (!this.enabled) return;
    if (e.button === 0) this.mouse.left = true;
    if (e.button === 2) this.mouse.right = true;
  }

  private mouseUp(e: MouseEvent): void {
    if (e.button === 0) this.mouse.left = false;
    if (e.button === 2) this.mouse.right = false;
  }

  private wheel(e: WheelEvent): void {
    if (!this.enabled) return;
    this.wheelAccum += e.deltaY;
    if (Math.abs(this.wheelAccum) > 60) {
      this.grenadeSlot = (this.grenadeSlot + (this.wheelAccum > 0 ? 1 : -1) + 5) % 5;
      this.wheelAccum = 0;
      this.onKeyAction?.('grenade_cycle');
    }
  }

  private pressed(code: string): boolean { return this.keys.has(code); }

  sample(): InputState {
    let forward = 0, right = 0;
    if (this.pressed(this.keybinds.forward)) forward += 1;
    if (this.pressed(this.keybinds.back)) forward -= 1;
    if (this.pressed(this.keybinds.right)) right += 1;
    if (this.pressed(this.keybinds.left)) right -= 1;
    const len = Math.hypot(forward, right);
    if (len > 1) { forward /= len; right /= len; }
    let buttons = 0;
    if (this.mouse.left) buttons |= Buttons.Fire;
    if (this.pressed(this.keybinds.jump)) buttons |= Buttons.Jump;
    if (this.pressed(this.keybinds.crouch)) buttons |= Buttons.Crouch;
    if (this.pressed(this.keybinds.walk)) buttons |= Buttons.Walk;
    if (this.pressed(this.keybinds.use)) buttons |= Buttons.Use;
    if (this.pressed(this.keybinds.reload)) buttons |= Buttons.Reload;
    if (this.pressed(this.keybinds.drop)) buttons |= Buttons.Drop;
    if (this.pressed(this.keybinds.inspect)) buttons |= Buttons.Inspect;
    if (this.mouse.right) buttons |= Buttons.Scope;
    if (this.pressed(this.keybinds.radio)) buttons |= Buttons.Radio;
    // chọn slot chỉ khi vừa nhấn (một tick)
    const slotKeys: [string, number][] = [
      [this.keybinds.slotPrimary, Buttons.SlotPrimary],
      [this.keybinds.slotSecondary, Buttons.SlotSecondary],
      [this.keybinds.slotKnife, Buttons.SlotKnife],
      [this.keybinds.slotGrenade, Buttons.SlotGrenade],
    ];
    for (const [code, bit] of slotKeys) {
      const down = this.pressed(code);
      if (down && !this.lastToggle[code]) buttons |= bit;
      this.lastToggle[code] = down;
    }
    return { forward, right, yaw: this.yaw, pitch: this.pitch, buttons, grenadeSlot: this.grenadeSlot };
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
    window.removeEventListener('wheel', this.boundWheel);
    this.canvas.removeEventListener('contextmenu', this.boundContext);
    document.removeEventListener('pointerlockchange', this.boundLockChange);
  }
}
