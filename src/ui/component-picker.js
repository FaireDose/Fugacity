/**
 * A component picker you can type into: a text field that lists the components matching what is typed
 * (name, alias, formula, CAS number or id; searchComponents in app-logic.js), best first. Used everywhere a
 * component is chosen: the workbench inputs, the flowsheet, and the diagram and property widgets.
 *
 * ARIA combobox with a list box (WAI-ARIA Authoring Practices, "Combobox"): the field keeps the focus, the
 * active option is announced through aria-activedescendant. Keys: ↓ / ↑ move through the matches, Enter picks
 * the active one (or the best match), Escape closes the list and restores the field, Tab leaves it.
 * The list is in the page flow, under the field, so a narrow panel or a chat frame never clips it.
 *
 *   componentPicker({
 *     id, label,                    // id of the field (the list is id + "-list"), and its accessible name
 *     components,                   // the components that can be chosen: [{ id, name, formula, cas, aliases }]
 *     value,                        // the chosen id (shown in the field), or null
 *     clearOnPick,                  // true for an "add" field: empty again after each pick
 *     placeholder,
 *     status(c) -> { note, disabled },   // optional: a note after the name, and whether it can be picked
 *     group(c) -> string,           // optional: heading of the component's group, shown while nothing is typed
 *     allowClear,                   // Enter on an empty field picks null (an optional slot)
 *     disabled, invalid, describedBy, fk,
 *     onPick(id | null),
 *   })
 */
import { h } from "./dom.js";
import { searchComponents } from "./app-logic.js";

export function componentPicker(o) {
  const listId = `${o.id}-list`;
  const byId = new Map(o.components.map(c => [c.id, c]));
  const shown = () => (o.value && !o.clearOnPick ? byId.get(o.value)?.name ?? o.valueLabel ?? o.value : "");
  const status = c => (o.status ? o.status(c) ?? {} : {});

  const input = h("input", {
    type: "text", id: o.id, class: "fug-pick-in", role: "combobox", autocomplete: "off", spellcheck: "false",
    "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId, "aria-label": o.label,
    "aria-invalid": o.invalid ? "true" : undefined, "aria-describedby": o.describedBy, "data-fk": o.fk,
    placeholder: o.placeholder ?? "Name, formula, CAS…", value: shown(), disabled: o.disabled || undefined,
    title: "Type a name, formula or CAS number",
  });
  const list = h("ul", { id: listId, class: "fug-pick-list", role: "listbox", "aria-label": o.label, hidden: true });
  const box = h("div", { class: "fug-pick" + (o.invalid ? " is-bad" : "") }, input, list);

  let matches = [], active = -1, open = false;

  function render(query) {
    const q = query.trim();
    // the ones that can be picked first (a stable split: the search order stays within each part)
    const found = searchComponents(o.components, q);
    matches = q ? [...found.filter(c => !status(c).disabled), ...found.filter(c => status(c).disabled)] : found;
    list.replaceChildren();
    active = -1;
    if (!matches.length) {
      list.append(h("li", { class: "fug-pick-none", role: "presentation" }, `No component matches “${q}”.`));
      return;
    }
    let lastGroup = null;
    matches.forEach((c, k) => {
      if (!q && o.group) {
        const g = o.group(c);
        if (g && g !== lastGroup) { list.append(h("li", { class: "fug-pick-group", role: "presentation" }, g)); lastGroup = g; }
      }
      const st = status(c);
      list.append(h("li", {
        id: `${o.id}-o${k}`, role: "option", class: "fug-pick-opt", "data-k": k, "aria-selected": "false",
        "aria-disabled": st.disabled ? "true" : undefined,
        on: { mousedown: ev => ev.preventDefault(), click: () => { if (!st.disabled) pick(c.id); } },
      },
      h("span", { class: "fug-pick-name" }, c.name),
      h("span", { class: "fug-pick-meta" }, [c.formula, c.cas].filter(Boolean).join(" · ")),
      st.note ? h("span", { class: "fug-pick-note" }, st.note) : null));
    });
    // the first match that can be picked is active, so Enter takes the best match
    setActive(matches.findIndex(c => !status(c).disabled));
  }

  function setOpen(v) {
    open = v;
    list.hidden = !v;
    input.setAttribute("aria-expanded", String(v));
    if (!v) { input.removeAttribute("aria-activedescendant"); active = -1; }
  }

  function setActive(k) {
    active = -1;
    input.removeAttribute("aria-activedescendant");
    for (const li of list.querySelectorAll('[role="option"]')) {
      const on = Number(li.dataset.k) === k;
      li.setAttribute("aria-selected", String(on));
      if (on) {
        active = k;
        input.setAttribute("aria-activedescendant", li.id);
        li.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  /** The next (step 1) or previous (step -1) match that can be picked, wrapping around. */
  function move(step) {
    let k = active < 0 ? (step > 0 ? -1 : 0) : active;
    for (let n = 0; n < matches.length; n++) {
      k = (k + step + matches.length) % matches.length;
      if (!status(matches[k]).disabled) { setActive(k); return; }
    }
  }

  function pick(id) {
    setOpen(false);
    input.value = o.clearOnPick ? "" : byId.get(id)?.name ?? "";
    o.onPick(id);
  }

  input.addEventListener("focus", () => { input.select(); render(""); setOpen(true); });
  input.addEventListener("input", () => { render(input.value); setOpen(true); });
  input.addEventListener("keydown", ev => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!open) { render(input.value === shown() ? "" : input.value); setOpen(true); }
      move(ev.key === "ArrowDown" ? 1 : -1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (!input.value.trim() && o.allowClear) { pick(null); return; }
      const c = matches[active];
      if (open && c && !status(c).disabled) pick(c.id);
    } else if (ev.key === "Escape") {
      if (open) { ev.preventDefault(); ev.stopPropagation(); setOpen(false); input.value = shown(); input.select(); }
    }
  });
  input.addEventListener("blur", () => { setOpen(false); input.value = shown(); });
  return box;
}
