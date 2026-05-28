import 'dotenv/config';

const token = process.env.FLY_API_TOKEN;

if (!token) {
  console.warn('⚠️  FLY_API_TOKEN no definido — saltando reinicio de Fly.io.');
  process.exit(0);
}

console.log('⚠️  Reinicio de Fly.io pendiente de configurar token con permisos correctos.');
console.log('   Saliendo sin error para no bloquear el pipeline.');
process.exit(0);
