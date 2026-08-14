import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem =
  | {
      type?: "item";
      id: string;
      label: string;
      disabled?: boolean;
      danger?: boolean;
      shortcut?: string;
      onSelect: () => void;
    }
  | {
      type: "separator";
      id: string;
    }
  | {
      type: "label";
      id: string;
      label: string;
    };

export type ContextMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type MenuProps = {
  menu: ContextMenuState | null;
  onClose: () => void;
};

const MENU_PAD = 8;
const EST_ITEM_H = 32;
const EST_SEP_H = 9;

function estimateHeight(items: ContextMenuItem[]): number {
  let h = 8;
  for (const item of items) {
    if (item.type === "separator") h += EST_SEP_H;
    else if (item.type === "label") h += 26;
    else h += EST_ITEM_H;
  }
  return h;
}

export function ContextMenu({ menu, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const w = ref.current?.offsetWidth ?? 220;
    const h = ref.current?.offsetHeight ?? estimateHeight(menu.items);
    const maxX = window.innerWidth - w - MENU_PAD;
    const maxY = window.innerHeight - h - MENU_PAD;
    setPos({
      x: Math.max(MENU_PAD, Math.min(menu.x, maxX)),
      y: Math.max(MENU_PAD, Math.min(menu.y, maxY)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onScroll = () => onClose();
    const onBlur = () => onClose();

    // Defer so the opening contextmenu event doesn't immediately close
    const t = window.setTimeout(() => {
      window.addEventListener("keydown", onKey);
      window.addEventListener("mousedown", onPointer, true);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("blur", onBlur);
      window.addEventListener("resize", onScroll);
    }, 0);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu, onClose]);

  if (!menu || menu.items.length === 0) return null;

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item) => {
        if (item.type === "separator") {
          return <div key={item.id} className="ctx-menu-sep" role="separator" />;
        }
        if (item.type === "label") {
          return (
            <div key={item.id} className="ctx-menu-label">
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ctx-menu-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              // Defer so close paint doesn't block action
              window.setTimeout(() => item.onSelect(), 0);
            }}
          >
            <span className="ctx-menu-item-label">{item.label}</span>
            {item.shortcut ? (
              <span className="ctx-menu-shortcut">{item.shortcut}</span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Hook: open a menu at the pointer; returns binder + portal node. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const close = useCallback(() => setMenu(null), []);

  const open = useCallback(
    (e: ReactMouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      const filtered = items.filter(Boolean);
      if (filtered.length === 0) return;
      setMenu({ x: e.clientX, y: e.clientY, items: filtered });
    },
    [],
  );

  const menuNode: ReactNode = <ContextMenu menu={menu} onClose={close} />;

  return { menu, open, close, menuNode };
}

/** Convenience: copy text to clipboard (returns success). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
