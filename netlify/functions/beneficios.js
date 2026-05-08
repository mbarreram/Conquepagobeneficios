
const falabella = require('./adapters/falabella');
const bci = require('./adapters/bci');
const bancochile = require('./adapters/bancochile');
const scotia = require('./adapters/scotia');
const bancoestado = require('./adapters/bancoestado');

exports.handler = async () => {
  const results = await Promise.allSettled([
    falabella(),
    bci(),
    bancochile(),
    scotia(),
    bancoestado()
  ]);

  const items = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  return {
    statusCode: 200,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ total: items.length, items })
  };
};
