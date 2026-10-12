// Login modal: two ways in — Microsoft (licence) and offline (nickname).
import { api, refreshAccounts, state } from '../api.js';
import { h, icon, btn, modal, toast } from '../ui.js';
import { logoCanvas } from '../blocks.js';
import { sfx } from '../sound.js';

export function openLogin({ welcome = false } = {}) {
  const body = h('div');
  const m = modal({ body, wide: false, closable: !welcome || state.accounts.list.length > 0 });

  const choose = () => {
    body.replaceChildren(
      welcome ? h('.welcome', h('.wlogo', logoCanvas(192)), h('h2', 'Добро пожаловать в Nebula'), h('p', 'Выбери, как входить в игру. Аккаунтов можно добавить сколько угодно и переключаться в один клик.')) : h('h2', { style: { fontFamily: 'var(--display)', fontSize: '20px', margin: '6px 0 16px' } }, 'Добавить аккаунт'),
      h('.login-choice',
        h('button.login-card', { onclick: microsoft, onmouseenter: () => sfx('hover') },
          h('.glow', { style: { background: '#00a4ef' } }),
          h('.lc-ico', { style: { background: 'rgba(255,255,255,.07)' } }, h('.ms-grid', h('i'), h('i'), h('i'), h('i'))),
          h('h4', 'Microsoft'), h('p', 'Лицензия. Онлайн-серверы, свой скин и плащи видят все.')),
        h('button.login-card', { onclick: offline, onmouseenter: () => sfx('hover') },
          h('.glow', { style: { background: 'var(--a1)' } }),
          h('.lc-ico', { style: { background: 'var(--grad)', color: '#0a0816' } }, icon('user-round')),
          h('h4', 'Оффлайн'), h('p', 'Просто ник. Одиночная игра, LAN и пиратские серверы. Скин тоже можно!'))),
      welcome ? h('p.dim', { style: { textAlign: 'center', fontSize: '12px', marginTop: '16px' } }, 'Данные аккаунтов хранятся только на этом компьютере, токены зашифрованы.') : null);
  };

  const offline = () => {
    sfx('click');
    const input = h('input.input', { placeholder: 'Например: Steve_2026', maxlength: 16, style: { height: '50px', fontSize: '17px', fontWeight: 700 } });
    const hint = h('.muted', { style: { fontSize: '12px' } }, '3–16 символов: латиница, цифры и _');
    const go = async () => {
      try {
        const acc = await api('accounts.addOffline', input.value.trim());
        await refreshAccounts();
        toast(`Привет, ${acc.name}!`, 'ok', 'Аккаунт добавлен');
        m.close();
        afterLogin(welcome);
      } catch (e) { hint.textContent = e.message; hint.style.color = 'var(--err)'; input.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 250 }); sfx('error'); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    input.addEventListener('input', () => { input.value = input.value.replace(/[^A-Za-z0-9_]/g, ''); });
    body.replaceChildren(
      h('.row', { style: { marginBottom: '14px' } }, btn('', { icon: 'arrow-left', cls: 'ghost icon sm', onclick: choose }), h('h2', { style: { fontFamily: 'var(--display)', fontSize: '19px' } }, 'Оффлайн-вход')),
      h('.col', input, hint,
        h('.row', { style: { marginTop: '10px', justifyContent: 'flex-end' } }, btn('Войти', { icon: 'log-in', cls: 'primary lg', onclick: go }))));
    setTimeout(() => input.focus(), 60);
  };

  const microsoft = async () => {
    sfx('click');
    body.replaceChildren(h('.empty', h('span.spinner', { style: { width: '40px', height: '40px', borderWidth: '4px' } }), h('h4', 'Войдите в открывшемся окне Microsoft'), h('p', 'После входа лаунчер проверит лицензию Minecraft: Java Edition.')));
    try {
      const acc = await api('accounts.addMicrosoft');
      await refreshAccounts();
      toast(`Лицензия подтверждена: ${acc.name}`, 'ok', 'Microsoft');
      m.close();
      afterLogin(welcome);
    } catch (e) {
      body.replaceChildren(h('.empty', icon('circle-alert'), h('h4', 'Не получилось войти'), h('p', e.message), btn('Назад', { icon: 'arrow-left', onclick: choose })));
    }
  };

  choose();
}

async function afterLogin(welcome) {
  if (welcome && !state.instances.length) {
    const { openWizard } = await import('./wizard.js');
    setTimeout(() => openWizard({ firstRun: true }), 350);
  }
}
