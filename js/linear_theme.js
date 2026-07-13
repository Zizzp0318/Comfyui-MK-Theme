import { app } from "../../scripts/app.js";

const comfyApp = app || window.comfyAPI?.app?.app;

/*
 * ComfyUI Group Styler — Group Beautification
 * Overrides LiteGraph group rendering: solid title bar, frosted-glass body,
 * thin borders, white dot + title.
 */

const LINEAR_GROUP_COLORS = {
    "#335": { bg: "#2a2a2e", accent: "#a1a1aa" },
    "#353": { bg: "#243624", accent: "#4ade80" },
    "#355": { bg: "#243636", accent: "#22d3ee" },
    "#533": { bg: "#362424", accent: "#f87171" },
    "#535": { bg: "#362436", accent: "#c084fc" },
    "#553": { bg: "#363624", accent: "#fbbf24" },
    "#555": { bg: "#2a2a2e", accent: "#a1a1aa" },
};

function _hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
    };
}

function _screenToGraph(canvas, px, py) {
    // Use LiteGraph built-in conversion if available
    if (canvas.convertOffsetToCanvas) {
        const pt = canvas.convertOffsetToCanvas([px, py]);
        if (pt) return [pt[0], pt[1]];
    }
    const scale = canvas.ds?.scale || 1;
    const offset = canvas.ds?.offset || [0, 0];
    // Correct formula: graph = (screen / scale) - offset
    return [
        (px / scale) - offset[0],
        (py / scale) - offset[1]
    ];
}

function _getCanvasPoint(canvas, event) {
    // Prefer offsetX/Y (relative to the canvas element itself)
    if (typeof event.offsetX === "number" && typeof event.offsetY === "number") {
        return [event.offsetX, event.offsetY];
    }
    // Fallback: clientX/Y minus canvas bounding rect
    const el = canvas.canvas || canvas.canvas_element;
    if (el && typeof event.clientX === "number") {
        const rect = el.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    }
    return null;
}

function _hitTestGroup(canvas, event) {
    const graph = canvas.graph;
    if (!graph) return null;
    const groups = graph._groups;
    if (!groups || groups.length === 0) return null;

    const screenPt = _getCanvasPoint(canvas, event);
    if (!screenPt) return null;

    const graphPt = _screenToGraph(canvas, screenPt[0], screenPt[1]);
    if (!graphPt) return null;
    const gx = graphPt[0], gy = graphPt[1];

    // Iterate in reverse so top-most group wins
    for (let i = groups.length - 1; i >= 0; i--) {
        const group = groups[i];
        if (!group) continue;
        const pos = group._pos || group.pos;
        const size = group._size || group.size;
        if (!pos || !size) continue;
        if (gx >= pos[0] && gx <= pos[0] + size[0] && gy >= pos[1] && gy <= pos[1] + size[1]) {
            return group;
        }
    }
    return null;
}

function installMouseHook() {
    const canvas = comfyApp?.canvas;
    if (!canvas) return false;
    if (canvas.__groupStylerMouseHooked) return true;

    const prevMouseDown = canvas.onMouseDown;
    canvas.onMouseDown = function(event) {
        if (typeof prevMouseDown === "function") {
            prevMouseDown.call(this, event);
        }

        // Only respond to left-click (button 0)
        if (event.button !== 0) return;

        const hit = _hitTestGroup(this, event);

        if (hit) {
            this._groupStylerHighlight = hit;
        } else {
            this._groupStylerHighlight = null;
        }
    };

    canvas.__groupStylerMouseHooked = true;
    return true;
}

function installGroupOverride() {
    if (!window.LGraphCanvas) return;
    if (!LGraphCanvas.prototype._origDrawGroups) {
        LGraphCanvas.prototype._origDrawGroups = LGraphCanvas.prototype.drawGroups;
    }

    LGraphCanvas.prototype.drawGroups = function(canvas, ctx) {
        if (!this.graph) return;
        const groups = this.graph._groups;
        if (!groups || groups.length === 0) return;

        ctx.save();
        const scale = this.ds?.scale || 1;

        if (scale < 0.2) { ctx.restore(); return; }

        const TITLE_H = 28;
        const R = 8;

        // Resolve highlighted group: custom tracking first, then LiteGraph fallback
        let highlightedGroup = this._groupStylerHighlight || null;

        if (!highlightedGroup) {
            highlightedGroup = this.selected_group || this.selectedGroup || null;
        }

        if (!highlightedGroup) {
            for (let i = 0; i < groups.length; i++) {
                const g = groups[i];
                if (g && (g.selected || g.is_selected || g.isSelected)) {
                    highlightedGroup = g;
                    break;
                }
            }
        }

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            if (!group) continue;

            const pos = group._pos || group.pos;
            const size = group._size || group.size;
            if (!pos || !size) continue;

            const rawColor = group.color || "#335";
            const palette = LINEAR_GROUP_COLORS[rawColor] || { bg: rawColor, accent: rawColor };
            const accentRgb = _hexToRgb(palette.accent);
            const bgRgb = _hexToRgb(palette.bg);

            const x = pos[0], y = pos[1], w = size[0], h = size[1];
            const isSelected = group === highlightedGroup;

            // Body: frosted glass
            ctx.fillStyle = isSelected
                ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.10)`
                : `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.05)`;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, R);
            ctx.fill();

            // Title bar: solid
            ctx.fillStyle = isSelected
                ? `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, 0.98)`
                : `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, 0.92)`;
            ctx.beginPath();
            ctx.moveTo(x + R, y);
            ctx.lineTo(x + w - R, y);
            ctx.arcTo(x + w, y, x + w, y + R, R);
            ctx.lineTo(x + w, y + TITLE_H);
            ctx.lineTo(x, y + TITLE_H);
            ctx.lineTo(x, y + R);
            ctx.arcTo(x, y, x + R, y, R);
            ctx.closePath();
            ctx.fill();

            // Border — highlighted when selected
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, R);
            if (isSelected) {
                ctx.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.85)`;
                ctx.lineWidth = 2;
            } else {
                ctx.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.35)`;
                ctx.lineWidth = 1;
            }
            ctx.stroke();

            // Separator
            ctx.beginPath();
            ctx.moveTo(x, y + TITLE_H);
            ctx.lineTo(x + w, y + TITLE_H);
            ctx.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.15)`;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Dot — white
            const dotR = 3;
            const dotX = x + 12, dotY = y + TITLE_H / 2;
            ctx.beginPath();
            ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.fill();

            // Title — white
            if (scale > 0.3) {
                const fontSize = 13;
                ctx.font = `500 ${fontSize}px Inter, Arial, sans-serif`;
                ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(group.title || "Group", x + 22, y + TITLE_H / 2);
            }
        }

        ctx.restore();
    };
}

comfyApp.registerExtension({
    name: "Comfy.GroupStyler",
    async setup() {
        // Install group rendering override immediately
        installGroupOverride();

        // Hook canvas mouse events — poll until canvas is available
        const tryHook = () => {
            if (!installMouseHook()) {
                requestAnimationFrame(tryHook);
            } else {
                console.log("[GroupStyler] Mouse hook installed, group highlight active");
            }
        };
        tryHook();

        console.log("[GroupStyler] Group beautification applied");
    },
});