/**
 * O pacote de assets usa um losango roxo translúcido como "marcador de sombra"
 * sob árvores/rochas/arbustos. Esse roxo não pertence à paisagem: aqui ele é
 * convertido em uma sombra escura suave, mantendo o alpha original (ou seja,
 * preservando transparência, pivô e proporção do sprite).
 */
export function sanitizeShadow(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a === 0) continue;
    // roxo do marcador: ~ (69,51,119)
    if (Math.abs(r - 69) < 30 && Math.abs(g - 51) < 30 && Math.abs(b - 119) < 34 && b > g && r > g) {
      data[i] = 16;
      data[i + 1] = 20;
      data[i + 2] = 26;
      data[i + 3] = Math.round(a * 0.85);
    }
  }
}
