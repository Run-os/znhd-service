// ScriptCat webhook 通知 —— ci/notify-scriptcat.sh 调用，由 .cnb.yml「部署」流水线在部署成功后执行。
// 构造仿 GitHub push 事件的 JSON 体（ScriptCat 按 GitHub webhook 约定解析仓库/分支/提交），
// 双 HMAC 签名头（X-Hub-Signature: sha1 / X-Hub-Signature-256: sha256，对原始 body 字节计算）。
// 环境变量由调用方注入：SC_URL / SC_SECRET / SC_SHA / SC_MSG / SC_REPO_FULL / SC_REPO_URL / SC_REF。
const crypto = require('crypto');

const repoFull = process.env.SC_REPO_FULL;
const repoUrl = process.env.SC_REPO_URL;
const host = repoUrl.replace(/^https?:\/\//, '');
const sha = process.env.SC_SHA;
const body = JSON.stringify({
  zen: 'Keep it logically simple.',
  ref: process.env.SC_REF,
  before: '',
  after: sha,
  repository: {
    id: 1,
    name: repoFull.split('/')[1],
    full_name: repoFull,
    private: false,
    html_url: repoUrl,
    clone_url: repoUrl + '.git',
    git_url: 'git://' + host + '/' + repoFull + '.git',
    ssh_url: 'git@' + host + ':' + repoFull + '.git',
    default_branch: 'main',
  },
  pusher: { name: 'cnb-ci', email: 'ci@cnb.cool' },
  sender: { login: repoFull.split('/')[0] },
  commits: [{
    id: sha,
    tree_id: '',
    distinct: true,
    message: (process.env.SC_MSG || '').slice(0, 200),
    timestamp: new Date().toISOString(),
    url: repoUrl + '/-/commit/' + sha,
    author: { name: 'cnb-ci', email: 'ci@cnb.cool' },
    committer: { name: 'cnb-ci', email: 'ci@cnb.cool' },
    added: [],
    removed: [],
    modified: [],
  }],
});

// GitHub 约定的两个 HMAC 签名头（对原始 body 字节计算）
const sign = (alg) =>
  alg + '=' + crypto.createHmac(alg, process.env.SC_SECRET).update(body).digest('hex');
const sig1 = sign('sha1');
const sig256 = sign('sha256');

(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(process.env.SC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GitHub-Hookshot/znhd-ci',
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': crypto.randomUUID(),
          'X-Hub-Signature': sig1,
          'X-Hub-Signature-256': sig256,
        },
        body,
      });
      const text = (await res.text()).slice(0, 300);
      console.log('HTTP ' + res.status + (text ? ' ' + text : ''));
      if (res.ok) {
        console.log('✅ ScriptCat webhook 通知成功（push ' + sha.slice(0, 8) + '）');
        process.exit(0);
      }
    } catch (e) {
      console.log('网络错误: ' + e.message);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
  }
  console.error('❌ ScriptCat webhook 通知失败（已重试 3 次）——部署本身已成功，仅脚本商店同步未触发');
  process.exit(1);
})();
