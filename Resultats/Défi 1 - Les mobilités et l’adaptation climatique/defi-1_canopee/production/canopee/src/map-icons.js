const SIZE = 64;
const SCALE = 2;

function canvas() {
  const element = document.createElement("canvas");
  element.width = SIZE;
  element.height = SIZE;
  const ctx = element.getContext("2d", { willReadFrequently: true });
  ctx.scale(SCALE, SCALE);
  return { element, ctx };
}

function disc(ctx, fill, stroke = "#ffffff") {
  ctx.beginPath();
  ctx.arc(16, 16, 11.5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function fountain(ctx, phase = 0) {
  ctx.clearRect(0, 0, 32, 32);
  if (phase > 0) {
    ctx.beginPath();
    ctx.arc(16, 16, 12 + phase * 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(4, 113, 170, ${0.5 * (1 - phase)})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
  disc(ctx, "#0878ad");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(8, 10, 13, 3.2, 1.2);
  ctx.roundRect(19, 11, 3, 4.5, 0.8);
  ctx.roundRect(13.5, 8, 2, 2.5, 0.5);
  ctx.roundRect(11, 6.8, 7, 1.8, 0.8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11, 20.5);
  ctx.lineTo(24, 20.5);
  ctx.lineTo(22.5, 24.5);
  ctx.lineTo(12.5, 24.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#b6eeff";
  ctx.beginPath();
  ctx.arc(20.5, 16.5 + phase * 3.1, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function tree(ctx) {
  disc(ctx, "#f1f8e9", "#4c872f");
  ctx.strokeStyle = "#6a4b30";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(16, 17);
  ctx.lineTo(16, 24);
  ctx.stroke();
  ctx.fillStyle = "#397b38";
  for (const [x, y, r] of [[12.3, 15.4, 3.7], [16.4, 12.5, 5], [20.1, 15.2, 3.8]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cool(ctx) {
  disc(ctx, "#eaf8f5", "#217464");
  ctx.strokeStyle = "#176c61";
  ctx.lineWidth = 1.65;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI) / 3;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(16 - dx * 6, 16 - dy * 6);
    ctx.lineTo(16 + dx * 6, 16 + dy * 6);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(16, 16, 1.7, 0, Math.PI * 2);
  ctx.fillStyle = "#176c61";
  ctx.fill();
}

function velo(ctx) {
  disc(ctx, "#0b6e4f");
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(11.2, 19.4, 3.15, 0, Math.PI * 2);
  ctx.arc(20.8, 19.4, 3.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(11.2, 19.4);
  ctx.lineTo(15.4, 13.1);
  ctx.lineTo(20.8, 19.4);
  ctx.moveTo(15.4, 13.1);
  ctx.lineTo(18.6, 13.1);
  ctx.stroke();
}

function station(ctx, alert) {
  disc(ctx, alert ? "#b34012" : "#214c83");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(10.2, 10.5, 11.6, 10, 2.2);
  ctx.fill();
  ctx.fillStyle = alert ? "#b34012" : "#214c83";
  ctx.fillRect(12.3, 12.5, 3, 3.2);
  ctx.fillRect(16.7, 12.5, 3, 3.2);
  ctx.beginPath();
  ctx.arc(12.8, 18, 0.95, 0, Math.PI * 2);
  ctx.arc(19.2, 18, 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(12.2, 22.3);
  ctx.lineTo(19.8, 22.3);
  ctx.stroke();
  if (alert) {
    ctx.beginPath();
    ctx.arc(24.5, 7.5, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#b34012";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = "#b34012";
    ctx.font = "bold 8px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", 24.5, 7.8);
  }
}

function staticImage(draw) {
  const { ctx } = canvas();
  draw(ctx);
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

function animatedFountain() {
  return {
    width: SIZE,
    height: SIZE,
    data: new Uint8Array(SIZE * SIZE * 4),
    onAdd(map) {
      this.map = map;
      this.surface = canvas();
      this.motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.timer = window.setInterval(() => {
        if (!document.hidden && !this.motion.matches && map.getLayer("points-eau") && map.getLayoutProperty("points-eau", "visibility") !== "none") {
          map.triggerRepaint();
        }
      }, 90);
    },
    render() {
      const phase = this.motion?.matches ? 0 : (performance.now() % 1700) / 1700;
      fountain(this.surface.ctx, phase);
      this.data.set(this.surface.ctx.getImageData(0, 0, SIZE, SIZE).data);
      return true;
    },
    onRemove() {
      window.clearInterval(this.timer);
    },
  };
}

export function registerMapIcons(map) {
  map.addImage("picto-fontaine", animatedFountain(), { pixelRatio: SCALE });
  map.addImage("picto-fraicheur", staticImage(cool), { pixelRatio: SCALE });
  map.addImage("picto-arbre", staticImage(tree), { pixelRatio: SCALE });
  map.addImage("picto-velo", staticImage(velo), { pixelRatio: SCALE });
  map.addImage("picto-station", staticImage((ctx) => station(ctx, false)), { pixelRatio: SCALE });
  map.addImage("picto-station-alerte", staticImage((ctx) => station(ctx, true)), { pixelRatio: SCALE });
}
