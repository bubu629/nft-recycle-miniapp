const RECEIVING_WALLET = "UQAi7GWc5DAPgpJxX7eOA_NijNeUHxpiirzAFi1OerKDRt85";
const ADMIN_KEY = "nft_admin_2026_secret";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const now = new Date().toISOString();

    try {
      if (request.method === "GET" && path === "/api/state") {
        const { results: nfts } = await env.DB.prepare("SELECT * FROM nfts ORDER BY updated_at DESC").all();
        const { results: events } = await env.DB.prepare("SELECT * FROM nft_events ORDER BY id DESC LIMIT 30").all();
        return json({ ok: true, receiving_wallet: RECEIVING_WALLET, recycle_rate: 0.80, nfts, events });
      }

      if (request.method !== "POST") return json({ ok: false, error: "Not Found" }, 404);
      const body = await request.json();
      const adminKey = request.headers.get("X-Admin-Key") || body.admin_key || "";
      const expectedAdmin = env.ADMIN_KEY || ADMIN_KEY;

      if (path === "/api/nfts/mint") {
        if (adminKey !== expectedAdmin) return json({ ok: false, error: "管理员密钥错误" }, 403);
        const { title, image_url, description = "", price, currency = "USDT" } = body;
        if (!title || !image_url || !price || Number(price) <= 0) {
          return json({ ok: false, error: "请填写完整名称、图片链接和有效价格" }, 400);
        }
        const id = "NFT-" + Date.now().toString(36).toUpperCase();
        await env.DB.prepare(
          `INSERT INTO nfts (id, title, image_url, description, price, currency, recycle_rate, status, cycle, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0.80, 'listed', 1, ?, ?)`
        ).bind(id, title.trim(), image_url.trim(), description.trim(), Number(price), currency, now, now).run();

        await env.DB.prepare(
          `INSERT INTO nft_events (nft_id, cycle, event_type, amount, note, created_at)
           VALUES (?, 1, 'mint', ?, ?, ?)`
        ).bind(id, Number(price), `首次铸造上架 (${currency})`, now).run();
        return json({ ok: true, id });
      }

      if (path === "/api/nfts/buy") {
        const { nft_id, buyer_tg_id = "", buyer_wallet, tx_ref } = body;
        if (!nft_id || !buyer_wallet || !tx_ref) {
          return json({ ok: false, error: "请填写 TON 钱包地址和转账交易单号" }, 400);
        }
        const nft = await env.DB.prepare("SELECT * FROM nfts WHERE id = ?").bind(nft_id).first();
        if (!nft) return json({ ok: false, error: "NFT 不存在" }, 404);
        if (nft.status !== "listed") return json({ ok: false, error: "该 NFT 当前不可购买" }, 409);

        const res = await env.DB.prepare(
          `UPDATE nfts
           SET status = 'held', owner_tg_id = ?, owner_wallet = ?, buy_tx_ref = ?,
               recycle_payout_wallet = '', recycle_tx_ref = '', updated_at = ?
           WHERE id = ? AND status = 'listed'`
        ).bind(String(buyer_tg_id), buyer_wallet.trim(), tx_ref.trim(), now, nft_id).run();
        if (!res.meta.changes) return json({ ok: false, error: "已被其他用户抢先购买" }, 409);

        await env.DB.prepare(
          `INSERT INTO nft_events (nft_id, cycle, event_type, actor_tg_id, wallet_address, tx_ref, amount, note, created_at)
           VALUES (?, ?, 'buy', ?, ?, ?, ?, ?, ?)`
        ).bind(nft_id, nft.cycle, String(buyer_tg_id), buyer_wallet.trim(), tx_ref.trim(), nft.price, `第 ${nft.cycle} 轮购买登记`, now).run();
        return json({ ok: true });
      }

      if (path === "/api/nfts/recycle") {
        const { nft_id, actor_tg_id = "", payout_wallet } = body;
        if (!nft_id || !payout_wallet) {
          return json({ ok: false, error: "请填写接收 80% 回收款的 TON 钱包地址" }, 400);
        }
        const nft = await env.DB.prepare("SELECT * FROM nfts WHERE id = ?").bind(nft_id).first();
        if (!nft) return json({ ok: false, error: "NFT 不存在" }, 404);
        if (nft.status !== "held") return json({ ok: false, error: "当前状态不可申请回收" }, 409);

        const refund = Number((nft.price * nft.recycle_rate).toFixed(4));
        const res = await env.DB.prepare(
          `UPDATE nfts SET status = 'recycle_pending', recycle_payout_wallet = ?, updated_at = ?
           WHERE id = ? AND status = 'held'`
        ).bind(payout_wallet.trim(), now, nft_id).run();
        if (!res.meta.changes) return json({ ok: false, error: "回收状态已变更，请刷新" }, 409);

        await env.DB.prepare(
          `INSERT INTO nft_events (nft_id, cycle, event_type, actor_tg_id, wallet_address, amount, note, created_at)
           VALUES (?, ?, 'recycle_request', ?, ?, ?, ?, ?)`
        ).bind(nft_id, nft.cycle, String(actor_tg_id), payout_wallet.trim(), refund, `申请 80% 回收 (${refund} ${nft.currency})`, now).run();
        return json({ ok: true, refund, currency: nft.currency });
      }

      if (path === "/api/nfts/relist") {
        if (adminKey !== expectedAdmin) return json({ ok: false, error: "管理员密钥错误" }, 403);
        const { nft_id, recycle_tx_ref, new_price } = body;
        if (!nft_id || !recycle_tx_ref) {
          return json({ ok: false, error: "请填写 80% 回收打款的交易单号" }, 400);
        }
        const nft = await env.DB.prepare("SELECT * FROM nfts WHERE id = ?").bind(nft_id).first();
        if (!nft) return json({ ok: false, error: "NFT 不存在" }, 404);
        if (nft.status !== "recycle_pending") return json({ ok: false, error: "该 NFT 未处于待回收打款状态" }, 409);

        const refund = Number((nft.price * nft.recycle_rate).toFixed(4));
        const nextPrice = new_price && Number(new_price) > 0 ? Number(new_price) : nft.price;
        const nextCycle = nft.cycle + 1;

        await env.DB.prepare(
          `INSERT INTO nft_events (nft_id, cycle, event_type, wallet_address, tx_ref, amount, note, created_at)
           VALUES (?, ?, 'recycle_paid', ?, ?, ?, ?, ?)`
        ).bind(nft_id, nft.cycle, nft.recycle_payout_wallet, recycle_tx_ref.trim(), refund, `已打款 80% 回收款并回库重售`, now).run();

        await env.DB.prepare(
          `UPDATE nfts
           SET status = 'listed', price = ?, cycle = ?,
               owner_tg_id = '', owner_wallet = '', buy_tx_ref = '',
               recycle_tx_ref = ?, updated_at = ?
           WHERE id = ?`
        ).bind(nextPrice, nextCycle, recycle_tx_ref.trim(), now, nft_id).run();

        await env.DB.prepare(
          `INSERT INTO nft_events (nft_id, cycle, event_type, amount, note, created_at)
           VALUES (?, ?, 'relist', ?, ?, ?)`
        ).bind(nft_id, nextCycle, nextPrice, `第 ${nextCycle} 轮重新上架销售`, now).run();
        return json({ ok: true, next_cycle: nextCycle, price: nextPrice });
      }

      return json({ ok: false, error: "Unknown endpoint" }, 404);
    } catch (err) {
      return json({ ok: false, error: err.message || "Server Error" }, 500);
    }
  },
};
