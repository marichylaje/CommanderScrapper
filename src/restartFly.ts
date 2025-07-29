import { execSync } from 'child_process';

const appName = 'typesense-commanderscrapper';
const token = process.env.FLY_API_TOKEN;

if (!token) {
  console.error('❌ FLY_API_TOKEN no definido en el entorno.');
  process.exit(1);
}

try {
  console.log(`⏹️ Apagando instancia de Fly.io...`);
  execSync(`flyctl scale count 0 -a ${appName} --access-token ${token}`, {
    stdio: 'inherit',
  });

  console.log(`🔁 Volviendo a levantar instancia...`);
  execSync(`flyctl scale count 1 -a ${appName} --access-token ${token}`, {
    stdio: 'inherit',
  });

  console.log('✅ Instancia reiniciada correctamente.');
} catch (err) {
  console.error('❌ Error al reiniciar Fly.io:', err);
  process.exit(1);
}
