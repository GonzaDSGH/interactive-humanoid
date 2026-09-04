# Memoria — Sentience: Ser Digital de Partículas

**Concepto.** Sentience es un busto humanoide generado en tiempo real que
existe únicamente como una nube de partículas: no hay malla, ni superficie,
ni imágenes. La figura —cráneo, rostro, cuello, hombros y torso superior—
emerge de dónde se permite que existan miles de puntos de luz, definidos por
campos de densidad analíticos (elipsoides moduladas por funciones de forma
direccionales) en `humanoidField.js`. Se renderiza íntegramente en la GPU
vía el contexto WebGL crudo de p5.js, con shaders propios y una única
llamada `drawArrays(POINTS)` por grupo, sosteniendo decenas de miles de
partículas por cuadro.

**Comportamiento autónomo y ruido coherente.** La obra nunca está quieta,
aunque nadie interactúe. Un campo de flujo basado en ruido simplex (Perlin
coherente) se evalúa por partícula, cada cuadro, en el vertex shader,
desplazando la masa de forma orgánica y continua en el tiempo. Este flujo
es la fuente de vida de la pieza —intencional, no decorativo— y coexiste
con una respiración sinusoidal lenta y una deriva propia.

**El micrófono como entrada obligatoria.** El sonido ambiente —captado vía
`p5.AudioIn`/`p5.FFT`— es la energía interna del ser. Los graves amplifican
su respiración estructural, las frecuencias medias intensifican la
turbulencia del ruido, los agudos encienden destellos en el borde de la
figura, y la amplitud eleva su brillo. Todo se suaviza exponencialmente
para que el sonido se sienta como una ola de energía, nunca un parpadeo.

**El mouse como atención secundaria.** El puntero no controla el cuerpo:
solo dirige su mirada, mediante una cascada de resortes de segundo orden
(rostro → cabeza → cuello → hombros → torso) que introduce inercia y
retraso realistas. Así, entrada pasiva (voz, ambiente) y entrada activa
(gesto) conviven como dos capas de un mismo organismo generativo: uno vive
de energía, el otro de atención.
