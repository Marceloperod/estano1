# Metales — app de precios (PWA)

App web instalable en el teléfono con el **cierre diario** de metales LME, plata, oro y el tipo de cambio.

| Dato | Detalle | Unidad | Fuente |
|---|---|---|---|
| Estaño, plomo, cobre, zinc, aluminio | LME Cash-Settlement, 3 meses, inventario | USD/t | westmetall.com (publica el cierre oficial LME) |
| Plata y oro | Cierre XAG/USD y XAU/USD | USD/oz troy | stooq.com (respaldo: Yahoo Finance) |
| Tipo de cambio | FIX Banxico | MXN por USD | API SIE de Banxico (respaldo: Yahoo / BCE) |

## Secciones de la app

- **Precios** — lista de metales con variación diaria; gráfica de precio, **spread cash–3M** (backwardation/contango) e **inventario LME**; selector **USD / MXN por kg**.
- **Promedios** — promedio del mes en curso y del anterior, y tabla de 13 meses (cash, 3M, FIX promedio y MXN/kg).
- **Calcular** — costo de aleación (Sn63/Pb37, Sn60/Pb40, Sn99.3/Cu0.7, SAC305, etc. o personalizada, con merma y costo de conversión) y precio de compra de scrap (% de contenido, % de pago LME, valor del lote en USD y MXN). Base: último cierre, promedio del mes en curso o del mes anterior.
- **Alertas** — avisos al teléfono cuando un metal cruza un precio o se mueve más de X % en el día.

## 1. Publicarla (unos 10 minutos, gratis)

1. Crea una cuenta en <https://github.com> si no tienes.
2. Crea un repositorio **público** llamado `metales` (GitHub Pages gratis requiere repo público).
3. **Add file → Upload files** y arrastra todo el contenido de esta carpeta (incluida la carpeta oculta `.github`; en Mac `Cmd+Shift+.` muestra archivos ocultos). *Commit*.
4. **Settings → Actions → General → Workflow permissions** → *Read and write permissions* → Save.
5. **Settings → Pages** → Build and deployment → Source: **GitHub Actions**. Tu app queda en `https://TU-USUARIO.github.io/metales/`. (La acción “Actualizar precios” publica la app cada vez que guarda precios nuevos.)

## 2. Tipo de cambio FIX de Banxico (recomendado, gratis)

1. Pide tu token en <https://www.banxico.org.mx/SieAPIRest/service/v1/token> (llega al instante).
2. En el repo: **Settings → Secrets and variables → Actions → New repository secret**. Nombre: `BANXICO_TOKEN`, valor: tu token.

Sin token la app usa el USD/MXN de Yahoo Finance o del Banco Central Europeo, y lo indica al pie de la app.

## 3. Alertas al teléfono (opcional, gratis)

1. Instala la app **ntfy** (iPhone o Android).
2. En ntfy toca **+** y suscríbete a un tema con un nombre difícil de adivinar, p. ej. `omega-metales-7k29qx` (cualquiera que conozca el nombre puede leer los avisos).
3. En el repo crea otro secreto: nombre `NTFY_TOPIC`, valor: ese mismo nombre.
4. Edita `alerts.json` (desde la pestaña **Alertas** de la app hay un botón que lo abre en GitHub). Reglas:
   - `{"metal":"tin","tipo":"sube","valor":35000}` — avisa si el estaño cierra por encima de 35,000 USD/t
   - `{"metal":"lead","tipo":"baja","valor":1900}` — avisa si el plomo cierra por debajo de 1,900 USD/t
   - `{"metal":"silver","tipo":"movimiento","valor":4}` — avisa si la plata se mueve ±4 % en el día

   Metales: `tin`, `lead`, `copper`, `zinc`, `aluminium`, `silver`, `gold`. Precios en USD/t (LME) o USD/oz (plata, oro).

Las alertas se revisan con cada cierre nuevo (una vez por día hábil) y no se repiten para el mismo cierre.

## 4. Primera carga e instalación

1. **Actions → Actualizar precios → Run workflow**. En ~1 min se llena `data/prices.json` con ~3 años de historial.
2. En el teléfono abre tu liga:
   - **iPhone:** Safari → Compartir → *Agregar a pantalla de inicio*.
   - **Android:** Chrome → menú ⋮ → *Instalar app*.

Para ver el diseño sin datos reales agrega `?demo=1` a la liga (datos simulados, marcados como DEMO).

## Archivos

- `index.html`, `style.css`, `app.js` — la app (sin librerías externas).
- `manifest.webmanifest`, `sw.js`, `icons/` — instalación y modo sin conexión.
- `alerts.json` — reglas de alertas.
- `scripts/update_prices.py` — descarga de precios y alertas (solo Python estándar).
- `.github/workflows/update-prices.yml` — horario: 18:10 y 22:10 UTC, lunes a viernes.

## Si algo falla

- El botón ↻ de la app vuelve a leer los precios del servidor; no descarga precios nuevos. Los precios nuevos los genera la acción de GitHub (L–V 12:10 y 16:10 CDMX). Si la app dice “La actualización automática no ha corrido…”, revisa **Actions**.
- GitHub pausa las acciones programadas de repos sin actividad por 60 días; si pasa, entra a Actions y vuelve a activarla.

- Si una fuente no responde, la app conserva el último dato y muestra un aviso.
- Si la acción sale en rojo, abre la ejecución en **Actions** y revisa el paso “Descargar precios y enviar alertas”: imprime cuántos días obtuvo por metal y qué fuente falló.
- Los precios LME son propiedad de LME; esta app los usa con fines informativos internos a partir de la publicación pública de westmetall.
