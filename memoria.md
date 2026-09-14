# Memoria — PRESENCIA

**Presencia** es una obra generativa en tiempo real donde la persona real que
está delante de la cámara se convierte en el material de la pieza. No hay
personaje virtual ni anatomía predefinida: si no hay nadie, no hay figura.

## Concepto

La cámara es la entrada física del sistema: el dispositivo observa un cuerpo
humano real y reinterpreta esa presencia como materia digital luminosa. La
imagen de vídeo nunca se muestra; es sólo un origen de datos.

## p5.js como marco creativo

p5.js gobierna todo el ciclo: `setup()`, `draw()`, el lienzo WEBGL a pantalla
completa, la captura de cámara, el redimensionado y la composición final. Sobre
ese contexto se dibujan cientos de miles de *point sprites* con shaders propios.

## BodySegmentation como capa de análisis

BodySegmentation separa a la persona del fondo en cada fotograma; FaceMesh y
BodyPose añaden, opcionalmente, saliencia facial y de extremidades. Nada de esto
se dibuja: ni máscara, ni malla, ni esqueleto. Son mapas de información.

## Sistemas de partículas

Dentro de esa máscara se mide la información real de la cámara —luminancia,
contraste local, bordes Sobel, diferencia entre fotogramas— y se combina en un
campo de importancia que decide qué partículas existen, cuánto brillan y cuánto
se mueven. Cada partícula conserva una celda y una semilla fijas, de modo que su
identidad nunca parpadea.

## Ruido coherente

El ruido de Perlin y un ruido de valor en GPU aportan deriva microscópica al
cuerpo y campos de flujo lentos al entorno, sin destruir nunca la legibilidad
humana.

## Movimiento real y comportamiento

El movimiento del cuerpo físico es la única interacción. Al moverse deprisa
aparecen estelas y dispersión; al detenerse, las partículas se reorganizan en la
forma real actual. Al salir de cuadro, la figura se disuelve y queda solamente
el entorno vivo.
