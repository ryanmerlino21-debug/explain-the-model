"""Explain the Model: three interactive explainers (Streamlit route).

Run locally:  uv run --with streamlit,pandas,numpy,altair streamlit run streamlit_app.py

Every number shown comes from outputs/<dataset>.json or the helpers in m10.py.
"""

import altair as alt
import pandas as pd
import streamlit as st

import m10

LABELS = {"glucose": "Fasting glucose", "sbp": "Blood pressure", "fev1": "Lung function (FEV₁)"}
UP, DOWN, GOOD, MUTED = "#e8590c", "#339af0", "#2f9e44", "#868e96"
ACCENT = "#4c8dff"


# ---- Small helpers -----------------------------------------------------------
def fmt(v: float, d: int = 1) -> str:
    return f"{v:,.{d}f}"


def signed(v: float, d: int = 1) -> str:
    return ("+" if v >= 0 else "−") + fmt(abs(v), d)


def coef_fmt(c: float) -> str:
    a = abs(c)
    return signed(c, 0 if a >= 100 else 1 if a >= 10 else 2 if a >= 1 else 3)


def val_fmt(v: float) -> str:
    return fmt(v, 0 if float(v).is_integer() else 1)


def short(label: str) -> str:
    out, depth = "", 0
    for ch in label:
        depth += ch == "("
        if depth == 0:
            out += ch
        depth -= ch == ")"
    return " ".join(out.split())


def feature_of(b: dict, name: str) -> dict:
    return next(f for f in b["features"] if f["name"] == name)


def sdev(a: list[float]) -> float:
    m = sum(a) / len(a)
    return (sum((v - m) ** 2 for v in a) / len(a)) ** 0.5


def show(chart: alt.Chart) -> None:
    try:
        st.altair_chart(chart, width="stretch")
    except TypeError:  # older Streamlit
        st.altair_chart(chart, use_container_width=True)


def category_of(b: dict, group: str, values: dict) -> str:
    g = next(g for g in b["categorical_groups"] if g["name"] == group)
    return next((lv["label"] for lv in g["levels"] if lv["column"] and values[lv["column"]] == 1), g["reference"])


def goal_box(text: str) -> None:
    st.info(f"**After this section you can:** {text}")


def person_line(b: dict, person: dict, values: dict | None = None) -> None:
    values = values or person["values"]
    grouped = {lv["column"] for g in b["categorical_groups"] for lv in g["levels"] if lv["column"]}
    bits = [f"{g['label']}: {category_of(b, g['name'], values)}" for g in b["categorical_groups"]]
    bits += [f"{short(f['label'])}: {val_fmt(values[f['name']])} {f['units']}" for f in b["features"] if f["name"] not in grouped]
    st.markdown(f"**{person['label']}** · _{person['why_chosen']}_  \n" + " · ".join(bits))


SELECTION: dict = {}


def pick_person() -> None:
    """Sidebar menus, drawn once above the pages so the choice carries from page to page."""
    key = st.sidebar.selectbox("Dataset", m10.DATASETS, format_func=LABELS.get, key="dataset")
    b = m10.load_bundle(key)
    labels = {p["id"]: f"{p['label']}: {p['description']} ({p['why_chosen']})" for p in b["people"]}
    pid = st.sidebar.selectbox("Example person", list(labels), format_func=labels.get, key=f"person_{key}")
    st.sidebar.caption(f"{b['target_label']} ({b['units']}). {b['n_train']:,} training people fit the models; "
                       f"{b['n_validation']:,} validation people were held back to check them.")
    SELECTION.update(b=b, person=next(p for p in b["people"] if p["id"] == pid))


def nice_domain(vals: list[float], pad: float = 0.08) -> list[float]:
    lo, hi = min(vals), max(vals)
    p = (hi - lo) * pad or 1
    return [lo - p, hi + p]


def line_chart(xs, series, xlabel, ylabel, sqrt=False, hlines=(), vlines=(), points=()):
    """series: [(name, y values, color, dashed)]. vlines/hlines/points carry their own labels."""
    rows = [{"x": x, "y": y, "series": name} for name, ys, _, _ in series for x, y in zip(xs, ys)]
    df = pd.DataFrame(rows)
    xscale = alt.Scale(type="sqrt", domain=[xs[0], xs[-1]], nice=False) if sqrt else alt.Scale(domain=[xs[0], xs[-1]], nice=False)
    allys = [y for _, ys, _, _ in series for y in ys] + [h[0] for h in hlines] + [p[1] for p in points]
    yscale = alt.Scale(domain=nice_domain(allys, 0.06), zero=False, nice=True)
    base = alt.Chart(df).mark_line(strokeWidth=2.2).encode(
        x=alt.X("x:Q", scale=xscale, title=xlabel, axis=alt.Axis(values=[0, 1, 10, 25, 50, 100, 200, 300, 400, 500]) if sqrt else alt.Axis()),
        y=alt.Y("y:Q", scale=yscale, title=ylabel),
        color=alt.Color("series:N", scale=alt.Scale(domain=[s[0] for s in series], range=[s[2] for s in series]), legend=alt.Legend(title=None, orient="top")),
        strokeDash=alt.StrokeDash("series:N", scale=alt.Scale(domain=[s[0] for s in series], range=[[6, 4] if s[3] else [1, 0] for s in series]), legend=None),
    )
    layers = [base]
    for v, label, color, dash in vlines:
        d = pd.DataFrame({"x": [v], "label": [label]})
        layers.append(alt.Chart(d).mark_rule(color=color, strokeDash=[4, 3] if dash else [1, 0], strokeWidth=1.5).encode(x=alt.X("x:Q", scale=xscale), tooltip=["label"]))
    for v, label, color in hlines:
        d = pd.DataFrame({"y": [v], "label": [label]})
        layers.append(alt.Chart(d).mark_rule(color=color, strokeDash=[5, 4], strokeWidth=1.5).encode(y=alt.Y("y:Q", scale=yscale), tooltip=["label"]))
    for x, y, label, color in points:
        d = pd.DataFrame({"x": [x], "y": [y], "label": [label]})
        layers.append(alt.Chart(d).mark_point(filled=True, size=110, color=color).encode(x=alt.X("x:Q", scale=xscale), y=alt.Y("y:Q", scale=yscale), tooltip=["label"]))
    return alt.layer(*layers).properties(height=280)


def strip_chart(values, lo, hi, on, tags, markers, xlabel, r=5.0, width=700):
    """One dot per value along an axis in target units; stacked where dots would overlap."""
    gap, placed, level = 1.5, [], []
    for v in values:
        px = (v - lo) / (hi - lo) * width
        lvl = 0
        while True:
            if lvl == len(placed):
                placed.append([])
            if all(abs(q - px) >= 2 * r + gap for q in placed[lvl]):
                placed[lvl].append(px)
                level.append(lvl)
                break
            lvl += 1
    top = len(placed) + 3
    df = pd.DataFrame({"x": values, "y": level, "included": ["included" if o else "left out" for o in on],
                       "tag": tags, "tip": [f"{t or 'dot'}: {v:,.1f}" for t, v in zip(tags, values)]})
    xs = alt.Scale(domain=[lo, hi], nice=False)
    ys = alt.Scale(domain=[-0.7, top])
    dots = alt.Chart(df).mark_circle(size=(2 * r) ** 2 * 0.9, opacity=0.9).encode(
        x=alt.X("x:Q", scale=xs, title=xlabel), y=alt.Y("y:Q", scale=ys, axis=None),
        color=alt.Color("included:N", scale=alt.Scale(domain=["included", "left out"], range=[ACCENT, "#adb5bd"]), legend=alt.Legend(title=None, orient="top") if not all(on) else None),
        tooltip=["tip"])
    layers = [dots]
    tagged = df[df.tag != ""]
    if len(tagged):
        layers.append(alt.Chart(tagged).mark_text(color="white", fontWeight="bold", fontSize=10).encode(x=alt.X("x:Q", scale=xs), y=alt.Y("y:Q", scale=ys), text="tag:N"))
    for i, (v, label, color, dash) in enumerate(markers):
        d = pd.DataFrame({"x": [v], "y": [top - 0.6 - i * 0.9], "label": [label]})
        layers.append(alt.Chart(d).mark_rule(color=color, strokeWidth=2, strokeDash=[4, 3] if dash else [1, 0]).encode(x=alt.X("x:Q", scale=xs), tooltip=["label"]))
        layers.append(alt.Chart(d).mark_text(align="left" if (v - lo) / (hi - lo) < 0.55 else "right", dx=6 if (v - lo) / (hi - lo) < 0.55 else -6,
                                             color=color, fontWeight="bold", fontSize=12).encode(x=alt.X("x:Q", scale=xs), y=alt.Y("y:Q", scale=ys), text="label:N"))
    return alt.layer(*layers).properties(height=max(200, int(top * (2 * r + gap) + 70)))


# ============================================================================
# 1. Push & Pull (linear regression)
# ============================================================================
def linear_page() -> None:
    b, person = SELECTION["b"], SELECTION["person"]
    u, lin, groups = b["units"], b["linear"], b["categorical_groups"]
    key = b["id"]
    st.header("Push & Pull")
    goal_box("rebuild a prediction from a **starting point** plus **one signed push per feature**, and tell a "
             "**coefficient** (the model's rule) apart from **one person's push**.")
    st.caption(f"**Linear regression** predicts {b['target_label'].lower()} with one straight-line rule: every feature has a "
               f"**coefficient**, the change in the prediction for 1 more unit of that feature, other features held fixed. "
               f"**Feature** = an input about the person. All numbers are in {u}.")

    grouped = {lv["column"] for g in groups for lv in g["levels"] if lv["column"]}
    numeric = [f for f in b["features"] if f["name"] not in grouped]
    wkey = lambda n: f"lin_{key}_{person['id']}_{n}"

    def reset() -> None:
        for k in [k for k in st.session_state if k.startswith(f"lin_{key}_{person['id']}_")]:
            del st.session_state[k]

    values = dict(person["values"])
    left, right = st.columns([1, 2], gap="large")
    with left:
        st.subheader("Change the person")
        st.caption("Drag or choose, and watch the prediction update.")
        for f in numeric:
            s = b["feature_stats"][f["name"]]
            step = 1.0 if f["name"] == "age" else 0.1
            values[f["name"]] = st.slider(f"{short(f['label'])} ({f['units']})", float(s["min"]), float(s["max"]),
                                          float(person["values"][f["name"]]), step=step, key=wkey(f["name"]),
                                          format="%.0f" if step == 1 else "%.1f",
                                          help=f"Training average {fmt(s['train_mean'], 2)} {f['units']}.")
        for g in groups:
            levels = [lv["label"] for lv in g["levels"]]
            cur = category_of(b, g["name"], person["values"])
            choice = st.selectbox(g["label"], levels, index=levels.index(cur), key=wkey(g["name"]),
                                  help=f"One menu, one push. The model's reference group is {g['reference']}.")
            values.update({lv["column"]: float(lv["label"] == choice) for lv in g["levels"] if lv["column"]})
        st.button(f"Reset to {person['label']}", on_click=reset)

    ex = m10.linear_explain(b, values)
    total = ex["prediction"] - ex["baseline"]
    unedited = all(abs(values[f["name"]] - person["values"][f["name"]]) < 1e-9 for f in b["features"])
    items = []
    for g in groups:
        items.append({"key": g["name"], "label": g["label"], "kind": "group", "g": g, "push": ex["grouped_pushes"][g["name"]],
                      "value": category_of(b, g["name"], values)})
    for f in numeric:
        items.append({"key": f["name"], "label": short(f["label"]), "kind": "num", "f": f, "push": ex["grouped_pushes"][f["name"]],
                      "value": f"{val_fmt(values[f['name']])} {f['units']}"})
    items.sort(key=lambda i: -abs(i["push"]))

    with right:
        st.subheader("The prediction, built from a starting point and pushes")
        c1, c2, c3 = st.columns(3)
        c1.metric("Starting point", f"{fmt(ex['baseline'])} {u}", help="The prediction for a person with every feature at the training average.")
        c2.metric(f"All {len(items)} pushes added", f"{signed(total)} {u}")
        c3.metric("Prediction", f"{fmt(ex['prediction'])} {u}")
        st.caption("Starting point + all pushes = prediction. Totals are rounded to one decimal.")

        run, rows, bars = ex["baseline"], [], []
        up = max((i for i in items if i["push"] > 0), key=lambda i: i["push"], default=None)
        down = min((i for i in items if i["push"] < 0), key=lambda i: i["push"], default=None)
        for i in items:
            a, c = run, run + i["push"]
            run = c
            tag = " (largest push up)" if i is up else " (largest push down)" if i is down else ""
            bars.append({"label": i["label"] + tag, "lo": min(a, c), "hi": max(a, c), "direction": "up" if i["push"] >= 0 else "down",
                         "txt": f"{'▲' if i['push'] >= 0 else '▼'} {signed(i['push'])}", "push": round(i["push"], 2)})
            rows.append((i["label"] + tag, i["value"], f"{signed(i['push'])} {u}", f"{fmt(c)} {u}"))
        order = ["Starting point"] + [x["label"] for x in bars] + ["Prediction"] + (["Observed"] if unedited else [])
        pts = [("Starting point", ex["baseline"], "#212529"), ("Prediction", ex["prediction"], ACCENT)]
        dom = nice_domain([ex["baseline"], ex["prediction"], *[x["lo"] for x in bars], *[x["hi"] for x in bars]] + ([person["observed"]] if unedited else []))
        xs = alt.Scale(domain=dom, nice=False, zero=False)
        yenc = alt.Y("label:N", sort=order, title=None, scale=alt.Scale(domain=order), axis=alt.Axis(labelLimit=300))
        xt = f"{b['target_label'].split(' (')[0]} ({u}); the axis does not start at zero, so bar lengths show pushes"
        layers = [
            alt.Chart(pd.DataFrame(bars)).mark_bar(height=18).encode(
                y=yenc, x=alt.X("lo:Q", scale=xs, title=xt), x2="hi:Q",
                color=alt.Color("direction:N", scale=alt.Scale(domain=["up", "down"], range=[UP, DOWN]), legend=alt.Legend(title="Push", orient="top")),
                tooltip=["label", "push"]),
            alt.Chart(pd.DataFrame(bars)).mark_text(align="left", dx=5, fontSize=12).encode(y=yenc, x=alt.X("hi:Q", scale=xs), text="txt:N"),
            alt.Chart(pd.DataFrame({"x": [ex["baseline"]]})).mark_rule(strokeDash=[4, 3], color=MUTED).encode(x=alt.X("x:Q", scale=xs)),
            alt.Chart(pd.DataFrame([{"label": n, "x": v, "c": c} for n, v, c in pts])).mark_tick(thickness=4, size=20).encode(
                y=yenc, x=alt.X("x:Q", scale=xs), color=alt.Color("c:N", scale=None)),
        ]
        if unedited:
            layers.append(alt.Chart(pd.DataFrame({"label": ["Observed"], "x": [person["observed"]]})).mark_point(
                shape="diamond", size=170, filled=False, stroke=GOOD, strokeWidth=3).encode(y=yenc, x=alt.X("x:Q", scale=xs)))
        show(alt.layer(*layers).properties(height=36 * len(order) + 40))
        st.table(pd.DataFrame([("Starting point", "average person", "", f"{fmt(ex['baseline'])} {u}"), *rows,
                               ("Prediction", "starting point + pushes", "", f"{fmt(ex['prediction'])} {u}")],
                              columns=["", "This person", "Push", "Running total"]).set_index(""))

    # Coefficient vs push
    st.subheader("Coefficient vs push")
    labels = {i["key"]: i["label"] for i in items}
    skey = f"lin_sel_{key}_{person['id']}"
    if st.session_state.get(skey) not in labels:
        st.session_state[skey] = items[0]["key"]
    sel_key = st.selectbox("Pick a feature to see how its push is calculated", list(labels), format_func=labels.get, key=skey)
    it = next(i for i in items if i["key"] == sel_key)
    if it["kind"] == "num":
        f = it["f"]
        c, avg, v = lin["coefficients"][f["name"]], lin["reference"][f["name"]], values[f["name"]]
        d = v - avg
        k1, k2, k3 = st.columns(3)
        k1.metric("1. Coefficient: the model's rule, the same for every person", f"{coef_fmt(c)} {u}",
                  f"per 1-unit increase in {it['label'].lower()} (unit: {f['units']}), other features held fixed", delta_color="off")
        k2.metric("2. This person's gap from the training average", f"{signed(d, 2)} {f['units']}", f"{val_fmt(v)} − {fmt(avg, 2)} (average)", delta_color="off")
        k3.metric("3. This person's push = coefficient × gap", f"{signed(it['push'], 2)} {u}", f"{coef_fmt(c)} × {signed(d, 2)} = {signed(c * d, 2)}", delta_color="off")
        st.write(f"If this person's {it['label']} were exactly average, the push would be 0 even though the coefficient stays "
                 f"{coef_fmt(c)} {u} per unit. Edit the value on the left to see it.")
    else:
        g = it["g"]
        cur = category_of(b, g["name"], values)
        lv = [l for l in g["levels"] if l["column"]]
        st.write(f"{g['label']} is a category, so the model stores one 0/1 column per group (1 = the person is in that group). The "
                 f"**reference group** ({g['reference']}) is only how the columns are coded: each coefficient compares a group with "
                 f"{g['reference']}, other features held fixed. The **push** is measured from the _training average mix_ instead, so even "
                 "a person in the reference group gets a small push.")
        trows = []
        for l in lv:
            c, x, sh = lin["coefficients"][l["column"]], values[l["column"]], lin["reference"][l["column"]]
            trows.append((("→ " if l["label"] == cur else "") + l["label"], f"{coef_fmt(c)} {u}", int(x), f"{sh * 100:.0f}%", f"{coef_fmt(c * (x - sh))} {u}"))
        trows.append((f"{g['reference']} (reference)", "0 (by definition)", int(all(values[l["column"]] == 0 for l in lv)),
                      f"{(1 - sum(lin['reference'][l['column']] for l in lv)) * 100:.0f}%", "—"))
        st.table(pd.DataFrame(trows, columns=["Group", f"Coefficient (vs {g['reference']})", "This person (1 = in group)",
                                              "Share of training people", "Contribution"]).set_index("Group"))
        st.write(f"**This person's {g['label'].lower()} push ({cur}): {signed(it['push'], 2)} {u}**")

    # One person vs overall
    st.subheader("One person's pushes ≠ which feature matters most overall")
    eff = lin["typical_effect_per_sd"]
    gen = sorted(numeric, key=lambda f: -abs(eff[f["name"]]))
    top_p, top_g = items[0], gen[0]
    if top_p["key"] == top_g["name"]:
        st.write(f"Here the same feature, **{short(top_g['label'])}**, has both the largest push for this person and the largest typical effect overall.")
    else:
        st.write(f"For this person the largest push comes from **{top_p['label']}** ({signed(top_p['push'])} {u}), but across people the largest "
                 f"typical effect belongs to **{short(top_g['label'])}** ({signed(eff[top_g['name']])} {u} per SD). Try editing "
                 f"{short(top_g['label']).lower()} to see its push grow.")
    with st.expander("See the difference, feature by feature"):
        st.write("A push answers: _for this person, how far did this feature move the prediction from the starting point?_ It is large only when "
                 "the person is far from average on that feature. **Typical effect per SD** answers a different question: _across people, how much "
                 "does the prediction change when this feature differs from average by a typical amount (one standard deviation)?_")
        st.table(pd.DataFrame([(f"{short(f['label'])} (1 SD = {fmt(b['feature_stats'][f['name']]['train_sd'])} {f['units']})",
                                f"{signed(eff[f['name']])} {u}", f"{signed(ex['grouped_pushes'][f['name']])} {u}") for f in gen],
                              columns=["Feature", "Overall: typical effect of 1 SD", "This person's push"]).set_index("Feature"))
        st.caption(f"{' and '.join(g['label'] for g in groups)} are categories, so they have no \"1 SD\" and are left out of the overall column.")

    # How close is the line
    if not unedited:
        st.warning(f"You've edited this person, so there is no measured value to compare with. Use \"Reset\" to return to {person['label']}.")
    else:
        diff, rmse = person["observed"] - ex["prediction"], lin["rmse"]["validation"]
        big = abs(diff) > 1.5 * rmse
        msg = (f"**How close is the line for {person['label']}?** Predicted {fmt(ex['prediction'])} {u}, observed {fmt(person['observed'])} {u}: "
               f"a miss of {signed(diff)} {u}. On all validation people the line's typical error (RMSE) is {fmt(rmse)} {u}.")
        if big:
            why = ("A straight line has one age coefficient, but lungs grow through childhood and then slowly shrink, so one slope cannot fit both. "
                   "This is the model, not a bug." if key == "fev1" else
                   "A straight line has one coefficient per feature, so it cannot bend to follow patterns that rise and then fall. This is the model, not a bug.")
            st.warning(f"{msg} This miss is much bigger than that. {why}")
        else:
            st.info(msg)
    st.caption(f"These are associations in a survey sample, not causes: the model does not say that changing one value would change a person's "
               f"{b['target_label'].lower()}.")


# ============================================================================
# 2. Wisdom of the Forest (random forest)
# ============================================================================
def forest_page() -> None:
    b, person = SELECTION["b"], SELECTION["person"]
    key, u, rf = b["id"], b["units"], b["forest"]
    P = rf["people"][person["id"]]
    trees, N = P["tree_predictions"], rf["n_trees"]
    uniq = rf["bootstrap_unique_training_rows"]
    dis = next((p for p in b["people"] if "disagree" in p["why_chosen"]), None)
    agr = next((p for p in b["people"] if "agree" in p["why_chosen"] and "disagree" not in p["why_chosen"]), None)

    st.header("Wisdom of the Forest")
    goal_box("explain how **varied trees** combine by **averaging**, and tell **disagreement between trees** apart from **real uncertainty** about a prediction.")
    st.caption(f"**Decision tree** = a flowchart of yes/no questions about a person's features that ends in one guess (in {u}). **Random forest** = "
               f"{N} slightly different trees. For a person, **every tree makes its own guess and the forest's prediction is the average of all {N} guesses**.")
    person_line(b, person)
    st.write(f"Observed (measured) value for this person: **{fmt(person['observed'])} {u}**.")

    def jump(pid: str) -> None:
        st.session_state[f"person_{key}"] = pid

    jc = st.columns([1, 1, 2])
    if dis:
        jc[0].button("Show a person the trees disagree on most", on_click=jump, args=(dis["id"],))
    if agr:
        jc[1].button("…and one they agree on", on_click=jump, args=(agr["id"],))

    st.subheader("Every dot is one tree's guess for this person")
    st.caption("Choose how many trees to include, in a fixed order (tree 1, tree 2, …). Filled dots are included in the average; grey dots are left out. "
               "Numbered dots are trees 1–5.")
    st.session_state.setdefault("ntrees", 10)

    def set_trees(n: int) -> None:
        st.session_state["ntrees"] = n

    k = st.slider("Trees included", 1, N, key="ntrees")
    pc = st.columns(6)
    for col, n in zip(pc, [1, 5, 10, 25, 50, N]):
        col.button("1 tree" if n == 1 else f"All {N}" if n == N else f"{n} trees", key=f"preset_{n}", on_click=set_trees, args=(n,))
    part = k < N
    avg = sum(trees[:k]) / k
    lo, hi = min(*trees, person["observed"]), max(*trees, person["observed"])
    pad = (hi - lo) * 0.04
    markers = [(avg, f"Partial forest: average of first {k} trees {fmt(avg)}" if part else f"Forest prediction: average of all {N} trees {fmt(avg)}", "#212529", False)]
    if part:
        markers.append((P["prediction"], f"All {N} trees {fmt(P['prediction'])}", MUTED, True))
    markers.append((person["observed"], f"Observed {fmt(person['observed'])}", GOOD, True))
    show(strip_chart(trees, lo - pad, hi + pad, [i < k for i in range(N)], [str(i + 1) if i < 5 else "" for i in range(N)], markers,
                     f"Guess for this person ({u})"))
    m = st.columns(4)
    m[0].metric(f"Partial forest: average of the first {k} of {N} trees" if part else f"Whole forest: average of all {N} trees", f"{fmt(avg)} {u}")
    m[1].metric(f"Forest prediction (average of all {N} trees)", f"{fmt(P['prediction'])} {u}")
    m[2].metric("Tree 1 alone", f"{fmt(trees[0])} {u}")
    m[3].metric(f"Disagreement: lowest to highest guess (SD {fmt(sdev(trees))} {u})", f"{fmt(min(trees))} to {fmt(max(trees))}")
    if part:
        st.caption(f"**Partial forest:** only {k} of the {N} trees are averaged, so this is not the forest's prediction yet.")

    st.subheader("Why does the average settle down?")
    xs = list(range(1, N + 1))
    run = [m10_running(trees, n) for n in xs]
    c1, c2 = st.columns(2)
    with c1:
        st.caption("**For this person:** the average of the first n trees as n grows.")
        show(line_chart(xs, [("average of the first n trees", run, ACCENT, False)], "Number of trees averaged (n)", f"Average prediction ({u})",
                        hlines=[(person["observed"], "observed", GOOD)], vlines=[(k, "partial forest" if part else "whole forest", "#212529", True)]))
    with c2:
        st.caption(f"**For all {b['n_validation']:,} validation people:** typical error of a forest with n trees.")
        show(line_chart(xs, [("validation RMSE", rf["validation_rmse_by_trees"], DOWN, False)], "Number of trees averaged (n)", f"Typical error, RMSE ({u})",
                        points=[(k, rf["validation_rmse_by_trees"][k - 1], f"{k} trees", "#212529")]))
    st.write(f"RMSE (root mean squared error) is a typical size of the miss, in {u}. {'Partial forest' if part else 'Whole forest'} of {k}: "
             f"**{fmt(rf['validation_rmse_by_trees'][k - 1])} {u}**. One tree alone: {fmt(rf['validation_rmse_by_trees'][0])} {u}. "
             f"All {N} trees: {fmt(rf['validation_rmse_by_trees'][N - 1])} {u}.")

    st.subheader("Why the trees differ")
    st.write("If every tree learned from the same people and could ask about the same features, they'd all be identical. Two random choices make them differ:")
    st.markdown(f"1. **Each tree learns from its own random sample of people.** It draws {rf['n_training_rows']:,} people from the training data _with "
                f"replacement_ (a \"bootstrap sample\"), so some people appear twice and some not at all. Each tree saw only {min(uniq):,} to {max(uniq):,} "
                f"different people (on average {sum(uniq) / len(uniq) / rf['n_training_rows'] * 100:.0f}% of the training people).\n"
                f"2. **At each question a tree may look at only {rf['features_tried_per_split']} of the {rf['n_features']} features,** chosen at random for that question.")
    roots: dict[str, list[float]] = {}
    for s in rf["root_split"]:
        roots.setdefault(s["feature"], []).append(s["threshold"])
    ranked = sorted(roots.items(), key=lambda kv: -len(kv[1]))
    with st.expander(f"See it in the data: the trees' first questions, and trees 1–5 for {person['label']}"):
        st.write(f"**What it does:** the {N} trees don't even ask the same first question.")
        st.table(pd.DataFrame([(short(feature_of(b, f)["label"]), f"{len(th)} of {N} trees") for f, th in ranked], columns=["First question asks about", "Trees"]).set_index("First question asks about"))
        tf, tth = ranked[0]
        st.caption(f"Even trees that start with the same feature use different cut-offs: for {short(feature_of(b, tf)['label'])}, from "
                   f"{min(tth):.2f} to {max(tth):.2f} {feature_of(b, tf)['units']}.")

        def step_text(s: dict) -> str:
            f = feature_of(b, s["feature"])
            if f["binary"]:
                return f"Is the person in group \"{short(f['label'])}\"? **{'Yes' if s['goes'] == '>' else 'No'}**"
            return (f"Is {short(f['label'])} ≤ {s['threshold']:.2f} ({f['units']})? **{'Yes' if s['goes'] == '≤' else 'No'}** "
                    f"(this person: {val_fmt(person['values'][s['feature']])})")

        tabs = st.tabs([f"Tree {i + 1}" for i in range(len(P["traced_trees"]))])
        for tab, t in zip(tabs, P["traced_trees"]):
            with tab:
                st.markdown("\n".join(f"{j + 1}. {step_text(s)}" for j, s in enumerate(t["steps"])))
                st.markdown(f"**Its guess: {fmt(t['leaf_value'])} {u}**")

    st.subheader("Disagreement between trees is not uncertainty")
    st.write("When trees **disagree**, their guesses are spread out. That describes the trees. It is **not a confidence interval or prediction "
             "interval**: nothing says the real value lies between the lowest and highest guess, or how likely any value is.")
    with st.expander("Compare all five example people"):
        rows = []
        for p in b["people"]:
            t = rf["people"][p["id"]]["tree_predictions"]
            fp = rf["people"][p["id"]]["prediction"]
            rows.append((f"{p['label']} ({p['description']}; {p['why_chosen']})", f"{fmt(min(t))} to {fmt(max(t))}", fmt(sdev(t)), fmt(fp),
                         fmt(p["observed"]), fmt(abs(fp - p["observed"]))))
        st.table(pd.DataFrame(rows, columns=["Person", f"Trees' lowest to highest guess ({u})", f"Disagreement (SD of guesses, {u})",
                                             f"Forest prediction ({u})", f"Observed ({u})", f"Forest missed by ({u})"]).set_index("Person"))
        st.caption("Compare the last two columns with the third: a wide spread doesn't tell you how big the miss will be.")

    st.subheader("Common questions")
    with st.expander("Why do the trees disagree?"):
        st.write("Each tree learned from a different sample of people and was allowed to ask about different features, so each draws different "
                 "boundaries. For a person near those boundaries, the trees land in different groups and give different guesses.")
    with st.expander("Why is the average steadier than one tree?"):
        st.write("One tree's guess leans on the quirks of its own sample. Other trees have different quirks, so their errors point in different "
                 f"directions and partly cancel in the average. Across the validation people the typical error (RMSE) falls from "
                 f"{fmt(rf['validation_rmse_by_trees'][0])} {u} for one tree to {fmt(rf['validation_rmse_by_trees'][N - 1])} {u} for all {N}. "
                 f"Use the slider to see where it settles for {person['label']}.")
    with st.expander("Isn't the spread of guesses a confidence interval?"):
        st.write("No. The spread only shows how much the trees disagree with each other. A confidence or prediction interval would come with a "
                 "stated chance of covering the real value; this spread does not.")
    with st.expander("Why can't the forest predict above the highest value it saw?"):
        rng = rf["training_target_range"]
        st.write(f"Each tree ends in a group of training people and guesses their average outcome, and the forest averages those guesses. An "
                 f"average can't be higher than the highest training outcome ({fmt(rng[1])} {u}) or lower than the lowest ({fmt(rng[0])} {u}), so "
                 "the forest can't predict beyond that range, even for a person who truly is beyond it.")


def m10_running(trees: list[float], n: int) -> float:
    return sum(trees[:n]) / n


# ============================================================================
# 3. One Correction at a Time (gradient boosting)
# ============================================================================
def boosting_page() -> None:
    b, person = SELECTION["b"], SELECTION["person"]
    key, u, gb = b["id"], b["units"], b["boosting"]
    p = gb["people"][person["id"]]
    M, lr, best = len(p["corrections"]), gb["learning_rate"], gb["best_validation_round"]
    trn, val = gb["rmse"]["train"], gb["rmse"]["validation"]
    low_train = min(range(len(trn)), key=lambda i: trn[i])
    c02, rs = gb["comparison_learning_rate_0_02"], gb["residual_snapshots"]
    closer = sum(abs(person["observed"] - p["staged"][i + 1]) < abs(person["observed"] - p["staged"][i]) for i in range(M))

    st.header("One Correction at a Time")
    goal_box("explain how boosting adds **one small correction per round**, and use **validation error** to choose when to stop.")
    st.caption("**Gradient boosting** builds a prediction in **rounds**. It starts with the training average, then each round adds one small decision "
               "tree, **fitted to the training residuals** (what the earlier rounds got wrong), to correct part of it. **Residual** = observed − "
               f"predicted for a training person. **Validation people** = {b['n_validation']:,} people held out from fitting, used to decide when to "
               f"stop. All numbers are in {u}.")
    person_line(b, person)
    st.write(f"Observed (measured) value for this person: **{fmt(person['observed'])} {u}**.")

    st.subheader("Step through the rounds")
    st.session_state.setdefault("round", 1)

    def go(n: int) -> None:
        st.session_state["round"] = max(0, min(M, n))

    r = st.slider("Round", 0, M, key="round")
    bc = st.columns(7)
    bc[0].button("◀ Previous", on_click=go, args=(r - 1,))
    bc[1].button("Next ▶", on_click=go, args=(r + 1,))
    for col, (n, lab) in zip(bc[2:], [(0, "Round 0"), (1, "Round 1"), (10, "Round 10"), (best, f"Best on validation: {best}"), (M, f"Round {M}")]):
        col.button(lab, key=f"go_{n}", on_click=go, args=(n,))

    if r == 0:
        st.metric("Round 0: the average outcome of the training people. No trees yet.", f"{fmt(gb['init'])} {u}")
        st.write(f"Everyone starts from the same prediction. Observed for this person: {fmt(person['observed'])} {u}, so the model is "
                 f"{fmt(abs(person['observed'] - p['staged'][0]))} {u} {'too low' if person['observed'] > p['staged'][0] else 'too high'}. "
                 "Step forward to watch trees correct it.")
    else:
        prev, cur, corr = p["staged"][r - 1], p["staged"][r], p["corrections"][r - 1]
        e = st.columns(3)
        e[0].metric(f"Prediction after round {r - 1}", f"{fmt(prev)} {u}")
        e[1].metric(f"+ Correction from tree {r} (already includes the learning rate)", f"{signed(corr, 2)} {u}")
        e[2].metric(f"= Prediction after round {r}", f"{fmt(cur)} {u}")
        better = abs(person["observed"] - cur) < abs(person["observed"] - prev)
        st.write(f"Tree {r} was fitted to the training residuals left after round {r - 1}, not to {person['label']}, who was held out. It is applied "
                 f"to this person like any new person. Distance from the observed value ({fmt(person['observed'])} {u}): "
                 f"{fmt(abs(person['observed'] - prev))} → {fmt(abs(person['observed'] - cur))} {u}, "
                 f"{':green[**closer ✓**]' if better else ':orange[**not closer ✗**]'}.")

    st.subheader("This person's prediction, round by round")
    xs = list(range(M + 1))
    vl = [(r, f"round {r}", "#212529", True)] + ([(best, f"lowest validation error: round {best}", MUTED, True)] if best != r else [])
    show(line_chart(xs, [("prediction after each round", p["staged"], ACCENT, False)],
                    "Round (number of trees added). The axis is stretched near 0 so early rounds are visible.", f"Prediction ({u})",
                    sqrt=True, hlines=[(person["observed"], "observed", GOOD)], vlines=vl))

    with st.expander("What is each tree fitted to? See the training residuals"):
        snaps = rs["rounds"]
        rr = max(s for s in snaps if s <= r)
        res = [o - q for o, q in zip(rs["observed"], rs["predictions"][str(rr)])]
        every = [o - q for s in snaps for o, q in zip(rs["observed"], rs["predictions"][str(s)])]
        rlo, rhi = min(every), max(every)
        rpad = (rhi - rlo) * 0.03
        st.write(f"Each new tree is trained to predict what the model so far still gets wrong on the **training** people: their residuals. The dots "
                 f"below are the residuals of {len(res)} training people (a sample) after round {rr}; the next tree is fitted to these. As rounds go "
                 "by, the dots crowd toward 0.")
        show(strip_chart(res, rlo - rpad, rhi + rpad, [True] * len(res), [""] * len(res), [(0.0, "0 = no miss", GOOD, False)],
                         f"Residual = observed − predicted ({u}) after round {rr}", r=2.6))
        st.caption(f"Showing the residuals after round {rr}" + (f" (rounds are only recorded at {', '.join(map(str, snaps))}; this is the latest one up to round {r})" if rr != r else "")
                   + f". Typical size (RMS): {fmt((sum(v * v for v in res) / len(res)) ** 0.5)} {u}. Sample of {len(res)} training people.")

    st.subheader("When should it stop? Training error vs validation error")
    st.write(f"**RMSE** (root mean squared error) is a typical size of the miss, in {u}. **Training error** is measured on the people the trees were "
             "fitted to; **validation error** on people they never saw.")
    show_lr = st.checkbox("Also show a separately fitted model with learning rate 0.02 (it learns more slowly)", key="lr02")
    series = [("training RMSE", trn, MUTED, False), ("validation RMSE", val, ACCENT, False)]
    if show_lr:
        series.append(("validation RMSE, learning rate 0.02", c02["rmse"]["validation"], GOOD, True))
    stop_key = f"stop_{key}"
    stop = st.session_state.get(stop_key)
    evl = [(r, f"round {r}", "#212529", True)]
    if stop is not None and stop != r:
        evl.append((stop, f"your stop: {stop}", "#f08c00", True))
    show(line_chart(xs, series, "Round (number of trees added). The axis is stretched near 0 so early rounds are visible.", f"Error, RMSE ({u})",
                    sqrt=True, vlines=evl, points=[(best, gb["best_validation_rmse"], f"Lowest validation RMSE: {fmt(gb['best_validation_rmse'])} {u} at round {best}", ACCENT)]))
    st.write(f"At round {r}: training RMSE **{fmt(trn[r])} {u}**, validation RMSE **{fmt(val[r])} {u}**. Lowest validation RMSE: "
             f"**{fmt(gb['best_validation_rmse'])} {u} at round {best}** (the dot)."
             + (f"  \nLearning rate 0.02 (separately fitted): lowest validation RMSE {fmt(c02['best_validation_rmse'])} {u} at round {c02['best_validation_round']}." if show_lr else ""))

    st.subheader("Pick your stopping round")
    st.write("Move the slider above to the round where you would stop, then press the button. The app compares it with the round that has the "
             "lowest _validation_ error, and with the round that has the lowest _training_ error.")

    def set_stop(n: int) -> None:
        st.session_state[stop_key] = n

    st.button(f"Use round {r} as my stopping round", type="primary", on_click=set_stop, args=(r,))
    if stop is None:
        st.caption("No stopping round chosen yet.")
    else:
        row = lambda lab, n: (lab, n, fmt(trn[n]), fmt(val[n]))
        st.table(pd.DataFrame([row("Your stopping round", stop), row("Lowest validation error", best), row("Lowest training error", low_train),
                               row("Final round", M)], columns=["Choice", "Round", f"Training RMSE ({u})", f"Validation RMSE ({u})"]).set_index("Choice"))
        diff = val[stop] - val[best]
        msg = ("You picked the round with the lowest validation error." if stop == best else
               f"At your round the validation error is {fmt(abs(diff))} {u} {'higher' if diff > 0 else 'lower'} than at the best round ({best}).")
        if low_train != best:
            msg += (f" The round with the lowest _training_ error (round {low_train}) has validation error {fmt(val[low_train])} {u}, "
                    f"{fmt(val[low_train] - val[best])} {u} worse than the best round: training error keeps improving by fitting the training "
                    "people ever more closely, not by getting better on new people.")
        st.write(msg)
        st.caption("The best round is a validation-based choice, not a test result: the validation people helped choose it, so its error is slightly optimistic.")

    st.subheader("Common questions")
    with st.expander("Why start at the average?"):
        st.write(f"With no information about a person, the average training outcome ({fmt(gb['init'])} {u}) is the single number that makes the "
                 "typical squared miss smallest. Every later tree then only has to fix what is left over.")
    with st.expander("Why are the corrections so small?"):
        st.write(f"Each tree's output is scaled by the learning rate ({lr}) before it is added, so no single tree can overcorrect. For {person['label']}, "
                 f"tree 1 adds {signed(p['corrections'][0], 2)} {u}. The corrections shown here already include that scaling, so they are added exactly "
                 "as given. A smaller rate (0.02) means even smaller steps and more rounds to get as far.")
    with st.expander("Why does training error keep falling when validation error doesn't?"):
        st.write(f"Later trees start fitting quirks of the training people, such as noise that won't repeat for anyone else. That lowers training error "
                 f"but not validation error. Here, training RMSE falls from {fmt(trn[0])} to {fmt(trn[M])} {u} over {M} rounds, while validation RMSE "
                 f"bottoms out at {fmt(gb['best_validation_rmse'])} {u} (round {best}) and ends at {fmt(val[M])} {u}.")
    with st.expander("Does every round improve every person?"):
        st.write(f"No. Each tree improves the training people on average, but any one person can move the wrong way. For {person['label']}, {closer} of "
                 f"{M} rounds moved the prediction closer to the observed value, and {M - closer} moved it further away or left it where it was.")
    with st.expander("Why \"validation\", not \"test\"?"):
        st.write("The validation people were not used to fit any tree, but they were used to choose the stopping round. So the error at that round is a "
                 "bit flattering: it is a validation-based choice, not a test result. An honest final score needs a separate test set that never "
                 "influenced any decision.")


st.set_page_config(page_title="Explain the Model", layout="wide")
st.title("Explain the Model")
st.caption("How three regression models turn a person's health data into a prediction. Data: CDC/NCHS NHANES public-use files; the example people "
           "are real survey participants. Everything shown is an association in the data, not a cause.")
pick_person()
st.navigation([
    st.Page(linear_page, title="1. Push & Pull", url_path="linear", default=True),
    st.Page(forest_page, title="2. Wisdom of the Forest", url_path="forest"),
    st.Page(boosting_page, title="3. One Correction at a Time", url_path="boosting"),
]).run()
