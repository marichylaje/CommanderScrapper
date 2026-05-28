import 'dotenv/config';

const APP_NAME = 'typesense-commanderscrapper';
const FLY_API_BASE = 'https://api.machines.dev/v1';

const token = process.env.FLY_API_TOKEN;

if (!token) {
  console.error('❌ FLY_API_TOKEN no definido en el entorno.');
  process.exit(1);
}

async function flyFetch(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${FLY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fly API ${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log(`🔍 Listando máquinas de ${APP_NAME}...`);
  const machines: { id: string; state: string }[] = await flyFetch(`/apps/${APP_NAME}/machines`);

  if (!machines || machines.length === 0) {
    console.log('⚠️  No se encontraron máquinas. Nada que reiniciar.');
    return;
  }

  console.log(`✅ ${machines.length} máquina(s) encontrada(s).`);

  for (const machine of machines) {
    console.log(`🔁 Reiniciando máquina ${machine.id} (estado: ${machine.state})...`);
    await flyFetch(`/apps/${APP_NAME}/machines/${machine.id}/restart`, 'POST');
    console.log(`   ✅ Máquina ${machine.id} reiniciada.`);
  }

  console.log('🎉 Todas las máquinas reiniciadas correctamente.');
}

main().catch((err) => {
  console.error('❌ Error al reiniciar Fly.io:', err);
  process.exit(1);
});
