import { SwiggyMcpToolService } from "./services/SwiggyMcpToolService.js";
import { SessionMemory } from "./session/SessionMemory.js";

export class Agent {
  private static service = new SwiggyMcpToolService();

  static async process(prompt: string, sessionId: string = "default") {
    const key = (k: string) => `${sessionId}:${k}`;
    const get = (k: string) => SessionMemory.get(key(k));
    const set = (k: string, v: any) => SessionMemory.set(key(k), v);

    const foodQuery = get("foodQuery");

    if (get("waitingForCouponFallback") && !get("couponFallbackDecisionMade")) {
      const lower = prompt.trim().toLowerCase();
      const continueChoice = ["continue", "1", "c"];
      const addMoreChoice = ["add more", "2", "would you like to add something else?", "add something else"];

      if (continueChoice.includes(lower)) {
        set("couponFallbackDecisionMade", true);
        set("waitingForCouponFallback", false);
        set("waitingForAddMore", false);
        set("waitingForConfirm", true);
        set("confirmDecisionMade", false);

        const addressId = String(get("addressId"));
        const cartResult: any = await Agent.service.callTool(
          "get_food_cart",
          {
            addressId,
            restaurantName: get("restaurantName")
          }
        );

        set("firstCartResult", cartResult);
        const cartTextFull = formatCart(cartResult);
        const cartText = cartTextFull.replace(/\nWould you like to add something else\?\n1\. Yes\n2\. No\s*$/i, "");

        return cartText + "\n\nWould you like to confirm your order?\n1. Yes\n2. No";
      }

      if (addMoreChoice.includes(lower)) {
        set("couponFallbackDecisionMade", true);
        set("waitingForCouponFallback", false);
        set("addMoreDecisionMade", false);
        set("waitingForAddMore", false);
        set("multiSelectMode", true);
        set("multiSelectedIndices", []);

        const menuItems = get("menuItems") ?? [];
        return formatMenuMulti(menuItems);
      }

      return "\nPlease choose an option.\n1. Continue\n2. Would you like to add something else?";
    }

    const knownCouponCodes = Array.isArray(get("availableCouponCodes")) ? get("availableCouponCodes") : [];
    const selectedCouponCode = getCouponCodeFromPrompt(prompt, knownCouponCodes);
    if (selectedCouponCode && get("addressId")) {
      const addressId = String(get("addressId"));
      const applyArgs: any = {
        couponCode: selectedCouponCode,
        addressId
      };

      if (get("cartId")) {
        applyArgs.cartId = String(get("cartId"));
      }

      console.log("\n==============================");
      console.log("[MCP TOOL] apply_food_coupon");
      console.log("==============================");

      const applyResult: any = await Agent.service.callTool("apply_food_coupon", applyArgs);
      const isError = applyResult?.isError === true || applyResult?.error === true || !!applyResult?.structuredContent?.error;
      const failureReason = extractCouponFailureReason(applyResult);

      if (!isError) {
        console.log("\n==============================");
        console.log("[MCP TOOL] get_food_cart (after coupon)");
        console.log("==============================");

        const cartResult: any = await Agent.service.callTool(
          "get_food_cart",
          {
            addressId,
            restaurantName: get("restaurantName")
          }
        );

        set("firstCartResult", cartResult);
        set("waitingForAddMore", true);
        set("addMoreDecisionMade", false);
        return `✓ Coupon ${selectedCouponCode} applied successfully\n\n` + formatCart(cartResult);
      }

      const reasonSuffix = failureReason ? `\nReason: ${failureReason}` : "";
      return `✕ Coupon ${selectedCouponCode} is not available for this order.${reasonSuffix}`;
    }

    // Coupon requests must take priority over the add-more / yes-no flow.
    if (looksLikeCouponQuery(prompt) && get("addressId") && get("restaurantId")) {
      const restaurantId = String(get("restaurantId"));
      const addressId = String(get("addressId"));
      const args: any = { restaurantId, addressId };

      const codeMatch = String(prompt || "").match(/(?:coupon|code)[^A-Za-z0-9]*([A-Za-z0-9]+)/i);
      if (codeMatch && codeMatch[1]) {
        args.couponCode = codeMatch[1];
      }

      console.log("\n==============================");
      console.log("[MCP TOOL] fetch_food_coupons");
      console.log("==============================");

      const couponResult: any = await Agent.service.callTool("fetch_food_coupons", args);
      set("availableCouponCodes", extractCouponCodes(couponResult));

      const sections = getCouponSectionsFromResult(couponResult);
      const applicableCoupons = getApplicableCouponsFromResult(couponResult);

      if (sections === undefined) {
        return "Coupon data was returned in an unexpected format. Please try again.";
      }

      if (applicableCoupons.length === 0) {
        set("waitingForCouponFallback", true);
        set("couponFallbackDecisionMade", false);
        return "No applicable coupons are available for this order.\n\nWould you like to continue with your current cart?\n1. Continue\n2. Would you like to add something else?";
      }

      return formatCouponResult(couponResult);
    }

    // Handle the add-more decision when a cart was just displayed.
    // This must be evaluated before the generic cart fallback below.
    if (get("waitingForAddMore") && !get("addMoreDecisionMade")) {
      const lower = prompt.trim().toLowerCase();
      const yes = ["yes", "y", "1"];
      const no = ["no", "n", "2"];

      if (yes.includes(lower)) {
        set("addMoreDecisionMade", true);
        set("waitingForAddMore", false);
        set("multiSelectMode", true);
        set("multiSelectedIndices", []);

        const menuItems = get("menuItems") ?? [];

        return formatMenuMulti(menuItems);
      }

      if (no.includes(lower)) {
        // Instead of finishing, ask for confirmation to place the order.
        set("addMoreDecisionMade", true);
        set("waitingForAddMore", false);
        set("waitingForConfirm", true);
        set("confirmDecisionMade", false);

        return "\nWould you like to confirm your order?\n1. Yes\n2. No";
      }

      return "\nPlease answer 'yes' or 'no'.\n1. Yes\n2. No";
    }

    // Handle the confirm-order prompt shown after the cart is displayed
    if (get("waitingForConfirm") && !get("confirmDecisionMade")) {
      const lower = prompt.trim().toLowerCase();
      const yes = ["yes", "y", "1"];
      const no = ["no", "n", "2"];

      if (yes.includes(lower)) {
        set("confirmDecisionMade", true);
        set("waitingForConfirm", false);

        // Start payment flow: refresh authoritative cart and fetch payment options
        console.log("\n==============================");
        console.log("[MCP TOOL] get_food_cart (for payment)");
        console.log("==============================");

        const cartResult: any = await Agent.service.callTool(
          "get_food_cart",
          {
            addressId: get("addressId"),
            restaurantName: get("restaurantName")
          }
        );

        set("firstCartResult", cartResult);
        // Show the authoritative cart to the user first (without the add-more footer)
        const cartTextFull = formatCart(cartResult);
        const cartText = cartTextFull.replace(/\nWould you like to add something else\?\n1\. Yes\n2\. No\s*$/i, "");

        // Use authoritative pricing from the live cart
        const pricing = cartResult?.structuredContent?.data?.pricing ?? cartResult?.data?.pricing ?? {};
        const toPay = Number(pricing?.to_pay ?? pricing?.toPay ?? pricing?.total ?? 0) || 0;

        // Tool-level restriction: do not place orders >= 1000 — show cart first, then restriction
        if (toPay >= 1000) {
          return cartText + "\n\nYour cart total is ₹" + toPay + ". Orders of ₹1000 or more must be placed in the Swiggy app.";
        }

        console.log("\n==============================");
        console.log("[MCP TOOL] get_payment_options");
        console.log("==============================");

        // Fetch payment options from MCP
        const payOpts: any = await Agent.service.callTool("get_payment_options", {
          addressId: get("addressId")
        });

        // Persist payment options for selection handling
        set("paymentOptionsResult", payOpts);
        set("waitingForPaymentMethod", true);
        set("paymentMethodChosen", false);

        // Build a single normalized list of payment method objects from any known response location
        const sc = payOpts?.structuredContent ?? payOpts?.data ?? null;

        const scAll = Array.isArray(sc?.allMethods) ? sc.allMethods : [];
        const scMobile = Array.isArray(sc?.platforms?.mobile?.methods) ? sc.platforms.mobile.methods : [];
        const scDesktop = Array.isArray(sc?.platforms?.desktop?.methods) ? sc.platforms.desktop.methods : [];
        const scCod = sc?.cod ? [sc.cod] : [];

        const topAll = Array.isArray(payOpts?.allMethods) ? payOpts.allMethods : [];
        const topMobile = Array.isArray(payOpts?.platforms?.mobile?.methods) ? payOpts.platforms.mobile.methods : [];
        const topDesktop = Array.isArray(payOpts?.platforms?.desktop?.methods) ? payOpts.platforms.desktop.methods : [];
        const topCod = payOpts?.cod ? [payOpts.cod] : [];

        // Merge with deterministic order: prefer structuredContent.allMethods, else mobile -> desktop -> cod -> all
        let normalized: any[] = [];
        if (scAll.length > 0) {
          normalized = scAll.slice();
        } else {
          // combine in stable order and avoid duplicates by id
          const seen = new Set<string>();
          const pushIfNew = (m: any) => {
            const id = m && (m.id ?? m.name ?? m.displayName ?? JSON.stringify(m));
            const key = String(id);
            if (!seen.has(key)) {
              seen.add(key);
              normalized.push(m);
            }
          };
          [ ...scMobile, ...topMobile, ...scDesktop, ...topDesktop, ...scCod, ...topCod, ...topAll ].forEach(pushIfNew);
        }

        const labelFor = (obj: any) => {
          if (obj == null) return String(obj);
          if (typeof obj === 'string') return obj;
          return obj.displayName ?? obj.display_name ?? obj.label ?? obj.name ?? obj.title ?? obj.id ?? String(obj);
        };

        // Store the exact array used for rendering so selection maps 1:1
        set("availablePaymentMethods", normalized);

        if (Array.isArray(normalized) && normalized.length > 0) {
          let out = "\nSelect a payment method:\n";
          for (let i = 0; i < normalized.length; i++) {
            out += `${i + 1}. ${labelFor(normalized[i])}\n`;
          }
          // Prefix the cart so the user sees the authoritative cart before choosing payment
          return cartText + "\n" + out;
        }

        // If normalized is empty, the tool may have embedded JSON inside `content` text blocks.
        try {
          const contentArray = Array.isArray(payOpts?.content) ? payOpts.content : [];
          for (const c of contentArray) {
            if (c && c.type === 'text' && typeof c.text === 'string') {
              const t = c.text.trim();
              if (t.startsWith('{') || t.startsWith('[')) {
                try {
                  const parsed = JSON.parse(t);
                  const psc = parsed?.structuredContent ?? parsed?.data ?? parsed;
                  const pAll = Array.isArray(psc?.allMethods) ? psc.allMethods : [];
                  const pMobile = Array.isArray(psc?.platforms?.mobile?.methods) ? psc.platforms.mobile.methods : [];
                  const pDesktop = Array.isArray(psc?.platforms?.desktop?.methods) ? psc.platforms.desktop.methods : [];
                  const pCod = psc?.cod ? [psc.cod] : [];
                  const seen = new Set(normalized.map((m: any) => String(m?.id ?? m?.name ?? m?.displayName ?? JSON.stringify(m))));
                  const pushIfNew = (m: any) => {
                    const id = m && (m.id ?? m.name ?? m.displayName ?? JSON.stringify(m));
                    const key = String(id);
                    if (!seen.has(key)) {
                      seen.add(key);
                      normalized.push(m);
                    }
                  };
                  [ ...pAll, ...pMobile, ...pDesktop, ...pCod ].forEach(pushIfNew);
                } catch (e) {
                  // ignore parse errors
                }
              }
            }
          }
        } catch (e) {}

        // After attempting to parse embedded content, if we now have methods, render them.
        if (Array.isArray(normalized) && normalized.length > 0) {
          set("availablePaymentMethods", normalized);
          let out = "\nSelect a payment method:\n";
          for (let i = 0; i < normalized.length; i++) {
            out += `${i + 1}. ${labelFor(normalized[i])}\n`;
          }
          // Prefix the cart so the user sees the authoritative cart before choosing payment
          return cartText + "\n" + out;
        }

        // No real methods found — show the tool-provided human message if present, else a fallback.
        const human = payOpts?.message ?? payOpts?.markdown ?? null;
        if (human) return human;
        return "\nNo payment methods available.";
      }

      if (no.includes(lower)) {
        set("confirmDecisionMade", true);
        set("waitingForConfirm", false);
        return "\nOkay, your order has not been confirmed.";
      }

      return "\nPlease answer 'yes' or 'no'.\n1. Yes\n2. No";
    }

    // Handle payment method selection after showing payment options
    if (get("waitingForPaymentMethod") && !get("paymentMethodChosen")) {
      const sel = prompt.trim();
      const num = parseInt(sel, 10);
      const payOpts = get("paymentOptionsResult") ?? {};

      // Use the stored array used to render the options so numbering maps 1:1
      const stored: any[] = get("availablePaymentMethods") ?? [];
      if (isNaN(num) || num < 1 || !Array.isArray(stored) || num > stored.length) {
        return "\nPlease choose a valid payment option number.";
      }

      const selectedMethod = stored[num - 1];
      set("paymentMethodChosen", true);
      set("waitingForPaymentMethod", false);
      set("selectedPaymentMethod", selectedMethod);

      // Build place_food_order args based on selection
      const addressId = get("addressId");
      const placeArgs: any = { addressId };

      const methodObj = selectedMethod;
      const intentId = methodObj?.id ?? methodObj?.methodId ?? methodObj?.value ?? null;
      const isIntent = methodObj?.kind === 'intent' || methodObj?.raw?.upiIntent === true || (typeof intentId === 'string' && intentId.includes('://'));
      const isQR = methodObj?.kind === 'qr' || String(methodObj?.id) === 'PayWithQR' || methodObj?.raw?.upiIntent === false && String(methodObj?.id).toLowerCase().includes('qr');
      const isCash = String(methodObj?.id).toLowerCase() === 'cod' || String(methodObj?.displayName ?? methodObj?.display_name ?? '').toLowerCase().includes('cash') || String(methodObj).toLowerCase().includes('cash');

      if (isIntent && intentId) {
        placeArgs.paymentMethod = 'UPI';
        placeArgs.intentApp = String(intentId);
      } else if (isQR) {
        placeArgs.paymentMethod = 'UPI';
        placeArgs.generateUPIQR = true;
      } else if (isCash) {
        placeArgs.paymentMethod = 'Cash';
      } else if (methodObj?.id) {
        placeArgs.paymentMethod = methodObj.id || methodObj.method || methodObj;
      }

      console.log("\n==============================");
      console.log("[MCP TOOL] place_food_order");
      console.log("==============================");

      const placeResp: any = await Agent.service.callTool("place_food_order", placeArgs);

      // If UPI pending, return the MCP message instructing the user to complete payment
      try {
        const status = placeResp?.status
          ?? placeResp?.result?.status
          ?? placeResp?.result?.structuredContent?.status
          ?? placeResp?.structuredContent?.status
          ?? placeResp?.result?.structuredContent?.data?.status
          ?? null;
        if (status === 'PENDING_PAYMENT') {
          // If we have a paasId/orderId, keep internal tracking. Do not require paasId
          // to show the Pay Now link — prefer the MCP `bridgeUrl` or `upiIntentUrl`.
          const paasId = placeResp?.paasId
            ?? placeResp?.paas_id
            ?? placeResp?.payment?.paasId
            ?? placeResp?.paymentTransactionId
            ?? placeResp?.transactionId
            ?? placeResp?.result?.paasId
            ?? placeResp?.result?.paas_id
            ?? placeResp?.result?.structuredContent?.paasId
            ?? null;
          const orderId = placeResp?.orderId
            ?? placeResp?.order_id
            ?? placeResp?.data?.orderId
            ?? placeResp?.result?.orderId
            ?? placeResp?.result?.order_id
            ?? placeResp?.result?.structuredContent?.orderId
            ?? null;
          // Determine friendly amount to show (check nested locations)
          const amount = placeResp?.totalAmount
            ?? placeResp?.paymentAmount
            ?? placeResp?.amount
            ?? placeResp?.result?.totalAmount
            ?? placeResp?.result?.paymentAmount
            ?? placeResp?.result?.structuredContent?.paymentAmount
            ?? placeResp?.structuredContent?.paymentAmount
            ?? placeResp?.structuredContent?.data?.paymentAmount
            ?? null;

          // Prefer bridgeUrl, then upiIntentUrl (check nested locations)
          const bridge = placeResp?.bridgeUrl
            ?? placeResp?.bridge_url
            ?? placeResp?.upiIntentUrl
            ?? placeResp?.upi_intent_url
            ?? placeResp?.result?.bridgeUrl
            ?? placeResp?.result?.structuredContent?.bridgeUrl
            ?? placeResp?.result?.structuredContent?.upiIntentUrl
            ?? placeResp?.structuredContent?.bridgeUrl
            ?? placeResp?.structuredContent?.data?.bridgeUrl
            ?? placeResp?.structuredContent?.data?.upiIntentUrl
            ?? placeResp?.structuredContent?.upiIntentUrl
            ?? null;

          // If we have neither a paasId (for tracking) nor a bridge URL to open,
          // fall back to the tool's human message or a generic prompt.
          if (!paasId && !bridge) {
            return placeResp?.message ?? "Payment started. Please complete the payment in your app.";
          }

          // Build a clean user message with a clickable Pay Now link (opens in new tab)
          let userMsg = "Payment is pending.\nPlease complete your payment using the option below.";
          if (amount) {
            const amtNum = Number(amount);
            userMsg += "\n\nAmount: ₹" + (Number.isFinite(amtNum) ? amtNum : amount);
          }
          if (bridge) {
            // Use an HTML anchor so the UI can open the payment link in a new tab/window.
            const safeUrl = String(bridge);
            userMsg += "\n\n" + `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Pay Now</a>` + "\n\nComplete the payment, then return to this page.";
          } else {
            userMsg += "\n\nComplete the payment in your UPI app, then return to this page.";
          }

          // Start background poller to preserve existing tracking and confirmation flow.
          (async () => {
            try {
              const maxAttempts = 15;
              const delayMs = 3000;
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs));
                const checkResp: any = await Agent.service.callTool("check_payment_status", {
                  paasId: String(paasId),
                  orderId: orderId ? String(orderId) : undefined,
                  addressId: get("addressId")
                });

                const checkStatus = checkResp?.status ?? checkResp?.result?.status ?? checkResp?.state ?? checkResp?.paymentStatus ?? null;

                if (checkStatus === 'SUCCESS' || checkStatus === 'PAID') {
                  const confirmArgs: any = { orderId: orderId ?? undefined };
                  if (get("addressId")) confirmArgs.addressId = get("addressId");
                  if (checkResp?.cartId) confirmArgs.cartId = checkResp.cartId;
                  if (checkResp?.lat) confirmArgs.lat = checkResp.lat;
                  if (checkResp?.lng) confirmArgs.lng = checkResp.lng;
                  await Agent.service.callTool("confirm_order", confirmArgs);
                  // store a simple flag/message in session for later retrieval
                  set("lastPaymentStatus", 'SUCCESS');
                  return;
                }

                if (checkStatus === 'FAILED' || checkStatus === 'CANCELLED' || checkStatus === 'TIMEOUT' || checkStatus === 'FAILED_PAYMENT') {
                  set("lastPaymentStatus", 'FAILED');
                  return;
                }
              }
              // timed out
              set("lastPaymentStatus", 'PENDING');
            } catch (e) {
              set("lastPaymentStatus", 'ERROR');
            }
          })();

          return userMsg;
        }
      } catch (e) {}

      // For non-pending responses, show the response message
      return placeResp?.message ?? JSON.stringify(placeResp);
    }

    // Handle a structured multi-quantity submission from the frontend.
    // This is a single-message payload sent after the QUANTITY DONE action.
    try {
      // Magic command to enable a one-time terminal diagnostic capture.
      // Send this exact string as a user message to enable capture for the session:
      // __ENABLE_DIAGNOSTIC_CAPTURE_ONCE__
      if (prompt && String(prompt).trim() === "__ENABLE_DIAGNOSTIC_CAPTURE_ONCE__") {
        set("diagnosticCaptureEnabled", true);
        set("diagnosticCaptured", false);
        return "Diagnostic capture enabled for one run. Proceed with your UI actions.";
      }

      const maybe = JSON.parse(prompt);
      if (
        maybe &&
        typeof maybe === "object" &&
        maybe.type === "multi_quantity_selection" &&
        Array.isArray(maybe.items)
      ) {
        // If diagnostics are enabled and not yet captured, log the incoming payload
        const diagEnabled = !!get("diagnosticCaptureEnabled");
        const diagDone = !!get("diagnosticCaptured");
        if (diagEnabled && !diagDone) {
          console.log("\n[DIAGNOSTIC] incoming multi_quantity_selection payload:", JSON.stringify(maybe, null, 2));
          // Do not mark captured here — allow downstream logs (combined payload/response)
          // to also print. The one-shot capture will be set after update/get.
        }
        const menuItems = get("menuItems") ?? [];

        if (!Array.isArray(menuItems) || menuItems.length === 0) {
          return "\nMenu is not available in session. Please re-open the menu and select items.";
        }

        // Validate and normalize the incoming items array
        const validated = maybe.items
          .map((it: any) => {
            const idx = Number(it.index);
            const qty = Number(it.quantity);
            return Number.isFinite(idx) && Number.isFinite(qty) && idx >= 1 && idx <= menuItems.length && qty > 0
              ? { index: idx, quantity: qty }
              : null;
          })
          .filter((x: any) => x !== null);

        if (validated.length === 0) {
          return "\nNo valid items were provided in the selection.";
        }

        // Preserve the full selection list as structured item/quantity pairs.
        // Do not reduce the payload to a single first item or a single session quantity.
        const queue = validated.map((v: any) => ({
          index: v.index,
          quantity: v.quantity,
          menuItem: menuItems[v.index - 1]
        })).filter((entry: any) => entry && entry.menuItem);

        // Initialize multi-collect state and store the full selection in session
        set("multiSelectionDone", true);
        set("multiSelectMode", false);
        set("multiSelectionQueue", queue);
        set("multiSelectedItems", queue.map((entry: any) => entry.menuItem));
        set("processingMultiIndex", 0);
        set("multiCollectMode", true);
        set("multiItemsResolved", []);
        set("multiSelectedQuantities", queue.map((entry: any) => entry.quantity));

        // Preserve the full multi-selection queue. The current item is derived from the
        // queue at runtime; do not collapse the entire selection to a single global item.
        const currentMultiEntry = queue[0];
        const first = currentMultiEntry?.menuItem;
        set("selectedMenuItem", first);
        set("quantity", Number(currentMultiEntry?.quantity ?? 1));

        console.log("\n==============================");
        console.log("[MCP TOOL] search_menu");
        console.log("==============================");

        const itemName = String(first?.name ?? first?.title ?? first?.dishName ?? "");

        const searchResult: any = await Agent.service.callTool("search_menu", {
          addressId: get("addressId"),
          query: itemName,
          restaurantIdOfAddedItem: get("restaurantId")
        });

        set("searchMenuResult", searchResult);

        const items = extractSearchMenuItems(searchResult);

        const cartItem = items.find((it: any) => matchesItem(it, itemName)) ?? items[0];

        if (!cartItem) {
          return "\nItem not found in search_menu results.";
        }

        set("cartItem", cartItem);

        const variants = extractVariants(cartItem);

        if (variants.length > 0) {
          const defaultVariants = selectDefaultVariants(variants);
          if (defaultVariants.length > 0) {
            set("selectedVariants", defaultVariants);
            set("pendingVariants", []);
            set("variantIndex", 0);
          } else {
            // In the multi-item flow we never ask the user to pick a variant.
            // Resolve the default variant only from the real MCP menu data; if none is available,
            // keep the item on the normal path without returning a prompt.
            set("selectedVariants", []);
            set("pendingVariants", []);
            set("variantIndex", 0);
          }
        }

        // No variants: set the quantity for the first item from the provided quantities
        const qtys = get("multiSelectedQuantities") ?? [];
        set("quantity", qtys && qtys.length > 0 ? qtys[0] : 1);
        // Continue to the regular flow which will perform the multi update when ready.
      }
    } catch (e) {
      // Not a JSON payload or parse failed — fall back to normal conversational handling.
    }

    // TURN 1: capture food query, fetch saved addresses
    if (!foodQuery) {
      const query = cleanQuery(prompt);
      set("foodQuery", query);

      console.log("\n==============================");
      console.log("[MCP TOOL] get_addresses");
      console.log("==============================");

      const addressesResult: any = await Agent.service.callTool(
        "get_addresses",
        {}
      );

      const addresses = extractList(addressesResult, "addresses");
      set("addresses", addresses);

      if (addresses.length === 0) {
        return "\nNo saved addresses found.";
      }

      return formatList(addresses, "Saved Addresses", [
        "addressLine",
        "address",
        "label",
        "name",
        "title"
      ]);
    }

    // TURN 2: select address, search restaurants
    if (!get("addressId")) {
      const addresses = get("addresses") ?? [];
      const selected = pickByNumberOrName(prompt, addresses);

      if (!selected) {
        return "\nInvalid address selection. Please try again.";
      }

      const addressId = String(
        selected.id ??
          selected.addressId ??
          selected.address_id ??
          ""
      );

      set("addressId", addressId);

      console.log("\n==============================");
      console.log("[MCP TOOL] search_restaurants");
      console.log("==============================");

      const restaurantsResult: any = await Agent.service.callTool(
        "search_restaurants",
        {
          addressId,
          query: foodQuery
        }
      );

      const restaurants = extractList(
        restaurantsResult,
        "restaurants"
      );

      set("restaurants", restaurants);

      if (restaurants.length === 0) {
        return "\nNo restaurants found.";
      }

      return formatList(
        restaurants,
        "Restaurants",
        ["name", "restaurantName", "title"]
      );
    }

    // TURN 3: select restaurant, fetch menu
    if (!get("restaurantId")) {
      const restaurants = get("restaurants") ?? [];
      const selected = pickByNumberOrName(prompt, restaurants);

      if (!selected) {
        return "\nInvalid restaurant selection. Please try again.";
      }

      const restaurantId = String(
        selected.id ??
          selected.restaurantId ??
          selected.restaurant_id ??
          selected.restaurant?.id ??
          ""
      );

      const restaurantName = String(
        selected.name ??
          selected.restaurantName ??
          selected.title ??
          selected.restaurant?.name ??
          ""
      );

      set("restaurantId", restaurantId);
      set("restaurantName", restaurantName);

      console.log("\n==============================");
      console.log("[MCP TOOL] get_restaurant_menu");
      console.log("==============================");

      const menuResult: any = await Agent.service.callTool(
        "get_restaurant_menu",
        {
          addressId: get("addressId"),
          restaurantId
        }
      );

      const menuItems = extractMenuItems(menuResult);
      set("menuItems", menuItems);

      if (menuItems.length === 0) {
        return "\nNo menu items found.";
      }

          return formatMenuMulti(menuItems);
    }

    // Multi-select menu input handling (after user chose Yes)
    if (get("multiSelectMode") && !get("multiSelectionDone")) {
      const menuItems = get("menuItems") ?? [];
      const raw = prompt.trim();

      if (/^done$/i.test(raw)) {
        const sel = get("multiSelectedIndices") ?? [];

        if (!Array.isArray(sel) || sel.length === 0) {
          return "\nNo items selected. Please select items or type DONE when finished.";
        }

        // Build the queue of selected menu objects while preserving the full selection set.
        const queue = sel
          .map((n: number) => {
            const idx = parseInt(String(n), 10);
            if (isNaN(idx) || idx < 1 || idx > menuItems.length) return null;
            return {
              index: idx,
              quantity: 1,
              menuItem: menuItems[idx - 1]
            };
          })
          .filter((x: any) => x !== null);

        if (queue.length === 0) {
          return "\nNo valid selections found. Please try again.";
        }

        // Enter multi-collect mode: we'll resolve each selected item (via search_menu)
        // and collect their final menu_item_id/variants/quantity into `multiItemsResolved`.
        set("multiSelectionDone", true);
        set("multiSelectMode", false);
        set("multiSelectionQueue", queue);
        set("multiSelectedItems", queue.map((entry: any) => entry.menuItem));
        set("processingMultiIndex", 0);
        set("multiCollectMode", true);
        set("multiItemsResolved", []);
        set("multiSelectedQuantities", queue.map((entry: any) => entry.quantity));

        // Start resolving the first queued item by running search_menu for it
        const first = queue[0]?.menuItem;
        const itemName = String(
          first.name ?? first.title ?? first.dishName ?? ""
        );

        set("selectedMenuItem", first);

        console.log("\n==============================");
        console.log("[MCP TOOL] search_menu");
        console.log("==============================");

        const searchResult: any = await Agent.service.callTool(
          "search_menu",
          {
            addressId: get("addressId"),
            query: itemName,
            restaurantIdOfAddedItem: get("restaurantId")
          }
        );

        set("searchMenuResult", searchResult);

        const items = extractSearchMenuItems(searchResult);

        const cartItem =
          items.find((it: any) => matchesItem(it, itemName)) ?? items[0];

        if (!cartItem) {
          return "\nItem not found in search_menu results.";
        }

        set("cartItem", cartItem);

        const variants = extractVariants(cartItem);

        if (variants.length > 0) {
          const defaultVariants = selectDefaultVariants(variants);
          set("selectedVariants", defaultVariants);
          set("pendingVariants", []);
          set("variantIndex", 0);
        }

        return "\nHow many would you like? (enter quantity)";
      }

      // Accept comma-separated selections or single numbers
      const parts = raw
        .split(/[,\s]+/) // allow commas or spaces
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && !/^,$/.test(p));

      const current = get("multiSelectedIndices") ?? [];

      for (const p of parts) {
        const num = parseInt(p, 10);
        if (isNaN(num)) continue;
        if (num < 1 || num > menuItems.length) continue;
        if (!current.includes(num)) current.push(num);
      }

      set("multiSelectedIndices", current);

      // Show current selections and prompt for more or DONE
      let out = "\nSelected:\n";
      (current as number[]).forEach((n: number, i: number) => {
        const mi = menuItems[n - 1];
        const name = mi?.name ?? mi?.title ?? mi?.dishName ?? "<unnamed>";
        out += `${i + 1}. ${name}\n`;
      });

      out += "\nSelect more items or enter DONE.";

      return out;
    }

    // TURN 4: select menu item, get full customization via search_menu
    if (!get("searchMenuResult")) {
      const menuItems = get("menuItems") ?? [];
      const selected = pickByNumberOrName(prompt, menuItems);

      if (!selected) {
        return "\nInvalid menu item selection. Please try again.";
      }

      const itemName = String(
        selected.name ??
          selected.title ??
          selected.dishName ??
          ""
      );

      set("selectedMenuItem", selected);

      console.log("\n==============================");
      console.log("[MCP TOOL] search_menu");
      console.log("==============================");

      const searchResult: any = await Agent.service.callTool(
        "search_menu",
        {
          addressId: get("addressId"),
          query: itemName,
          restaurantIdOfAddedItem: get("restaurantId")
        }
      );

      set("searchMenuResult", searchResult);

      const items = extractSearchMenuItems(searchResult);

      const cartItem =
        items.find((it: any) => matchesItem(it, itemName)) ??
        items[0];

      if (!cartItem) {
        return "\nItem not found in search_menu results.";
      }

      set("cartItem", cartItem);

      const variants = extractVariants(cartItem);

      if (variants.length > 0) {
        const defaultVariants = selectDefaultVariants(variants);
        if (defaultVariants.length > 0) {
          set("selectedVariants", defaultVariants);
          set("pendingVariants", []);
          set("variantIndex", 0);
        } else {
          set("selectedVariants", []);
          set("pendingVariants", []);
          set("variantIndex", 0);
        }
      }

      return "\nHow many would you like? (enter quantity)";
    }

    // TURN 5: variant selection / quantity
    if (!get("quantity")) {
      const pendingVariants = get("pendingVariants") ?? [];
      const variantIndex = get("variantIndex") ?? 0;

      if (
        pendingVariants.length > 0 &&
        variantIndex < pendingVariants.length
      ) {
        if (get("multiCollectMode") || get("multiSelectionDone")) {
          const defaultVariants = selectDefaultVariants(pendingVariants);
          set("selectedVariants", defaultVariants);
          set("pendingVariants", []);
          set("variantIndex", 0);
          return "\nHow many would you like? (enter quantity)";
        }

        const group = pendingVariants[variantIndex];
        const choice = pickVariantChoice(prompt, group);

        if (!choice) {
          // The multi-item flow must never enter the interactive prompt state.
          // If a user somehow reaches here outside the multi-item path, keep the behavior safe and
          // avoid emitting a variant question by auto-selecting the first valid option.
          const fallback = selectDefaultVariants([group]);
          set("selectedVariants", fallback);
          set("pendingVariants", []);
          set("variantIndex", 0);
          return "\nHow many would you like? (enter quantity)";
        }

        const selectedVariants =
          get("selectedVariants") ?? [];

        selectedVariants.push({
          group_id: group.group_id,
          variation_id: choice.variation_id
        });

        set("selectedVariants", selectedVariants);

        const next = variantIndex + 1;
        set("variantIndex", next);

        if (next < pendingVariants.length) {
          return "\nHow many would you like? (enter quantity)";
        }

        return "\nHow many would you like? (enter quantity)";
      }

      const qty = parseInt(prompt, 10);

      if (isNaN(qty) || qty <= 0) {
        return "\nPlease enter a valid quantity (e.g. 1, 2).";
      }

      set("quantity", qty);
    }

    // TURN 6: update_food_cart, then get_food_cart
    // Allow updates if we're actively processing a multi-selection queue
    const _queue = get("multiSelectionQueue") ?? null;
    const _procIndex = get("processingMultiIndex");
    const _processingQueueItem =
      Array.isArray(_queue) &&
      _procIndex !== undefined &&
      _procIndex !== null &&
      _procIndex <= _queue.length - 1;

    if (!get("cartUpdated") || _processingQueueItem) {
      const queueEntry = Array.isArray(_queue) && _procIndex !== undefined && _procIndex !== null ? _queue[_procIndex] : null;
      const cartItem = get("cartItem");
      const quantity = Number(queueEntry?.quantity ?? get("quantity") ?? 1);
      const selectedVariants =
        get("selectedVariants") ?? [];

      // For multi-item flows, the authoritative quantity is always the queue entry for the
      // current item. We must not use only the first item or a single global quantity.
      if (get("multiCollectMode") && queueEntry && queueEntry.quantity !== undefined) {
        set("quantity", Number(queueEntry.quantity));
      }

      if (!cartItem) {
        return "\nUnable to add the selected item to the cart because the cart item was not found.";
      }

      const menuItemId = resolveMenuItemId(queueEntry?.menuItem ?? cartItem);

      if (!menuItemId) {
        return "\nUnable to add the selected item to the cart because the menu item ID was not found.";
      }

      const cartItems: any[] = [
        {
          menu_item_id: menuItemId,
          quantity
        }
      ];

      console.log('[AGENT] update_food_cart payload before send:', JSON.stringify(cartItems, null, 2));

      // (no-op) selected items are in `cartItems` variable

      const hasVariations =
        Array.isArray(cartItem.variations) &&
        cartItem.variations.length > 0;

      const hasVariantsV2 =
        Array.isArray(cartItem.variantsV2) &&
        cartItem.variantsV2.length > 0;

      if (
        hasVariations &&
        selectedVariants.length > 0
      ) {
        cartItems[0].variants = selectedVariants;
      } else if (
        hasVariantsV2 &&
        selectedVariants.length > 0
      ) {
        cartItems[0].variantsV2 = selectedVariants;
      }

      console.log("\n==============================");
      console.log("[MCP TOOL] update_food_cart");
      console.log("==============================");

      const inMultiCollect = !!get("multiCollectMode");

      if (!inMultiCollect) {
        // For single-item flows we must merge the new single item with the
        // existing live cart so update_food_cart receives the COMPLETE cart.
        // Merge existing live cart with the single new item so update_food_cart gets the COMPLETE cart
        let combinedForUpdate: any[] = [];
        try {
          const existingCartResult: any = await Agent.service.callTool(
            "get_food_cart",
            {
              addressId: get("addressId"),
              restaurantName: get("restaurantName")
            }
          );

          const existingItems = extractCartItems(existingCartResult) ?? [];

          const normalizedExisting = existingItems
            .map((it: any) => {
              const rawId = it.menu_item_id ?? it.menuItemId ?? it.id ?? it.item_id ?? "";
              const numId = Number(rawId);
              const id = rawId !== "" && !Number.isNaN(numId) ? numId : String(rawId);
              const qty = Number(it.quantity ?? it.qty ?? it.qty_selected ?? 0) || 0;
              const entry: any = { menu_item_id: id, quantity: qty };
              if (it.variants) entry.variants = it.variants;
              if (it.variantsV2) entry.variantsV2 = it.variantsV2;
              if (it.addons) entry.addons = it.addons;
              return entry;
            })
            .filter((e: any) => e.menu_item_id !== "");

          combinedForUpdate = mergeCartItems(normalizedExisting, cartItems);
        } catch (e) {
          console.warn("Failed to fetch existing cart for single-item merge, proceeding with single item.", e);
          combinedForUpdate = mergeCartItems([], cartItems);
        }

        // Validate combinedForUpdate against the restaurant menu and filter invalid IDs
        const validIds = await buildValidMenuItemIdSet(get, Agent.service);
        let filteredForUpdate = combinedForUpdate.filter((c) => c && c.menu_item_id !== undefined && validIds.has(String(c.menu_item_id)));

        if (!Array.isArray(filteredForUpdate) || filteredForUpdate.length === 0) {
          // Nothing valid to send — fetch authoritative cart and return it instead of sending invalid payload
          const cartResult: any = await Agent.service.callTool("get_food_cart", { addressId: get("addressId"), restaurantName: get("restaurantName") });
          set("firstCartResult", cartResult);
          set("cartUpdated", true);
          return formatCart(cartResult);
        }

        const updateResp: any = await Agent.service.callTool(
          "update_food_cart",
          {
            restaurantId: get("restaurantId"),
            cartItems: filteredForUpdate,
            addressId: get("addressId"),
            restaurantName: get("restaurantName")
          }
        );

        console.log('[AGENT] update_food_cart raw response:', JSON.stringify(updateResp, null, 2));
        console.log('[AGENT] update_food_cart response structuredContent.data.items:', JSON.stringify(updateResp?.structuredContent?.data?.items ?? null, null, 2));
        console.log('[AGENT] update_food_cart response pricing:', JSON.stringify(updateResp?.structuredContent?.data?.pricing ?? null, null, 2));
        console.log('[AGENT] update_food_cart response errorCodes:', JSON.stringify(updateResp?.structuredContent?.errorCodes ?? null, null, 2));
        console.log('[AGENT] update_food_cart response statusMessage:', JSON.stringify(updateResp?.structuredContent?.statusMessage ?? null, null, 2));
        console.log("update_food_cart succeeded");

        // If diagnostic enabled and not yet captured, log the combined payload and response
        try {
          const diagEnabled = !!get("diagnosticCaptureEnabled");
          const diagDone = !!get("diagnosticCaptured");
          if (diagEnabled && !diagDone) {
            console.log("\n[DIAGNOSTIC] combinedCartItems before update_food_cart (single):", JSON.stringify(combinedForUpdate, null, 2));
            console.log("\n[DIAGNOSTIC] update_food_cart response (single):", JSON.stringify(updateResp, null, 2));
            set("diagnosticCaptured", true);
          }
        } catch (e) {}
      } else {
        console.log("skipping per-item update_food_cart while collecting multi items");
      }

      // If we're in multi-collect mode, preserve the full queue and build the final
      // cart update from all selected items. Do not fall through after the first item,
      // because that silently drops the remaining queue entries from the final payload.
      if (get("multiCollectMode")) {
        const resolved = get("multiItemsResolved") ?? [];

        const entry: any = {
          menu_item_id: menuItemId,
          quantity
        };

        if (hasVariations && selectedVariants.length > 0) {
          entry.variants = selectedVariants;
        } else if (hasVariantsV2 && selectedVariants.length > 0) {
          entry.variantsV2 = selectedVariants;
        }

        resolved.push(entry);
        set("multiItemsResolved", resolved);

        const queue = Array.isArray(_queue) ? _queue : [];
        const multiQtys = get("multiSelectedQuantities") ?? [];
        const finalCartItems = queue
          .map((queueEntry: any, index: number) => {
            const item = queueEntry?.menuItem ?? queueEntry;
            const itemId = resolveMenuItemId(item);
            if (!itemId) return null;
            const itemQty = Number(queueEntry?.quantity ?? multiQtys[index] ?? 1);
            const result: any = {
              menu_item_id: itemId,
              quantity: Number.isFinite(itemQty) && itemQty > 0 ? itemQty : 1
            };
            if (Array.isArray(queueEntry?.variants) && queueEntry.variants.length > 0) {
              result.variants = queueEntry.variants;
            }
            if (Array.isArray(queueEntry?.variantsV2) && queueEntry.variantsV2.length > 0) {
              result.variantsV2 = queueEntry.variantsV2;
            }
            return result;
          })
          .filter((entry: any) => entry && entry.menu_item_id !== undefined && entry.menu_item_id !== "");

        console.log("\n==============================");
        console.log("[MCP TOOL] update_food_cart (multi)");
        console.log("==============================");

        // Merge existing live cart items (if any) with the newly collected items
        // so that update_food_cart receives the COMPLETE cart state.
        // Merge existing live cart with the newly collected items so update_food_cart receives the COMPLETE cart state.
        let combinedCartItems: any[] = [];
        try {
          const existingCartResult: any = await Agent.service.callTool(
            "get_food_cart",
            {
              addressId: get("addressId"),
              restaurantName: get("restaurantName")
            }
          );

          const existingItems = extractCartItems(existingCartResult) ?? [];

          const normalizedExisting = existingItems
            .map((it: any) => {
              const rawId = it.menu_item_id ?? it.menuItemId ?? it.id ?? it.item_id ?? "";
              const numId = Number(rawId);
              const id = rawId !== "" && !Number.isNaN(numId) ? numId : String(rawId);
              const qty = Number(it.quantity ?? it.qty ?? it.qty_selected ?? 0) || 0;
              const entry: any = { menu_item_id: id, quantity: qty };
              if (it.variants) entry.variants = it.variants;
              if (it.variantsV2) entry.variantsV2 = it.variantsV2;
              if (it.addons) entry.addons = it.addons;
              return entry;
            })
            .filter((e: any) => e.menu_item_id !== "");

          combinedCartItems = mergeCartItems(normalizedExisting, finalCartItems);
        } catch (e) {
          console.warn("Failed to fetch existing cart for merge, proceeding with collected items.", e);
          combinedCartItems = mergeCartItems([], finalCartItems);
        }

        // Validate combinedCartItems against menu and filter invalid IDs
        const validIdsMulti = await buildValidMenuItemIdSet(get, Agent.service);
        const filteredCombinedCartItems = combinedCartItems.filter((c) => c && c.menu_item_id !== undefined && validIdsMulti.has(String(c.menu_item_id)));

        if (!Array.isArray(filteredCombinedCartItems) || filteredCombinedCartItems.length === 0) {
          const cartResult: any = await Agent.service.callTool("get_food_cart", { addressId: get("addressId"), restaurantName: get("restaurantName") });
          set("firstCartResult", cartResult);
          set("cartUpdated", true);
          // reset multi-collect flags
          set("multiCollectMode", false);
          set("multiSelectionQueue", undefined);
          set("multiItemsResolved", undefined);
          set("processingMultiIndex", undefined);
          // allow add-more decision after cart display
          set("waitingForAddMore", true);
          set("addMoreDecisionMade", false);
          return formatCart(cartResult);
        }

        const updateResp: any = await Agent.service.callTool(
          "update_food_cart",
          {
            restaurantId: get("restaurantId"),
            cartItems: filteredCombinedCartItems,
            addressId: get("addressId"),
            restaurantName: get("restaurantName")
          }
        );

        console.log('[AGENT] multi update_food_cart payload before send:', JSON.stringify(filteredCombinedCartItems, null, 2));
        console.log('[AGENT] multi update_food_cart raw response:', JSON.stringify(updateResp, null, 2));
        console.log('[AGENT] multi update_food_cart response structuredContent.data.items:', JSON.stringify(updateResp?.structuredContent?.data?.items ?? null, null, 2));
        console.log('[AGENT] multi update_food_cart response pricing:', JSON.stringify(updateResp?.structuredContent?.data?.pricing ?? null, null, 2));
        console.log('[AGENT] multi update_food_cart response errorCodes:', JSON.stringify(updateResp?.structuredContent?.errorCodes ?? null, null, 2));
        console.log('[AGENT] multi update_food_cart response statusMessage:', JSON.stringify(updateResp?.structuredContent?.statusMessage ?? null, null, 2));
        console.log("multi update_food_cart succeeded");

        console.log("\n==============================");
        console.log("[MCP TOOL] get_food_cart");
        console.log("==============================");

        const cartResult: any =
          await Agent.service.callTool(
            "get_food_cart",
            {
              addressId: get("addressId"),
              restaurantName: get("restaurantName")
            }
          );

        console.log('[AGENT] get_food_cart raw response:', JSON.stringify(cartResult, null, 2));
        console.log('[AGENT] get_food_cart structuredContent.data.items:', JSON.stringify(cartResult?.structuredContent?.data?.items ?? null, null, 2));
        console.log('[AGENT] get_food_cart structuredContent.data.item_count:', JSON.stringify(cartResult?.structuredContent?.data?.item_count ?? null, null, 2));
        console.log('[AGENT] get_food_cart structuredContent.data.pricing:', JSON.stringify(cartResult?.structuredContent?.data?.pricing ?? null, null, 2));
        console.log('[AGENT] get_food_cart structuredContent.errorCodes:', JSON.stringify(cartResult?.structuredContent?.errorCodes ?? null, null, 2));
        console.log('[AGENT] get_food_cart structuredContent.statusMessage:', JSON.stringify(cartResult?.structuredContent?.statusMessage ?? null, null, 2));

        // (no-op) cartResult will be used below to display authoritative cart

        set("firstCartResult", cartResult);
        set("cartUpdated", true);
        // reset multi-collect flags
        set("multiCollectMode", false);
        set("multiSelectionQueue", undefined);
        set("multiItemsResolved", undefined);
        set("processingMultiIndex", undefined);

        // allow add-more decision after cart display
        set("waitingForAddMore", true);
        set("addMoreDecisionMade", false);

        return formatCart(cartResult);
      }

      // Non-multi path: normal single-item update -> get cart
      console.log("\n==============================");
      console.log("[MCP TOOL] get_food_cart");
      console.log("==============================");

      const cartResult: any =
        await Agent.service.callTool(
          "get_food_cart",
          {
            addressId: get("addressId"),
            restaurantName: get("restaurantName")
          }
        );

      // (no-op) cartResult returned and used below

      set("firstCartResult", cartResult);
      set("cartUpdated", true);
      // allow add-more decision after cart display
      set("waitingForAddMore", true);
      set("addMoreDecisionMade", false);

      return formatCart(cartResult);
    }

    return "\nCart is already displayed. Type 'exit' to end.";
  }
}

function cleanQuery(prompt: string): string {
  return prompt
    .replace(
      /^(i want|i would like|i'd like|please|can i get|give me|order|get me|want)\s+/i,
      ""
    )
    .replace(/[.,!?]+$/g, "")
    .trim();
}

function extractList(
  result: any,
  keyName: string
): any[] {
  const sc = result?.structuredContent;

  if (sc && Array.isArray(sc[keyName])) {
    return sc[keyName];
  }

  if (Array.isArray(result?.[keyName])) {
    return result[keyName];
  }

  return [];
}

function extractMenuItems(result: any): any[] {
  const sc = result?.structuredContent;

  const candidates = [
    sc?.items,
    sc?.menuItems,
    sc?.dishes,
    result?.items,
    result?.menuItems,
    result?.dishes
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c;
    }
  }

  const cats =
    sc?.categories ??
    result?.categories;

  if (Array.isArray(cats)) {
    const items: any[] = [];

    for (const cat of cats) {
      const catItems =
        cat?.items ??
        cat?.menuItems ??
        cat?.dishes ??
        [];

      if (Array.isArray(catItems)) {
        items.push(...catItems);
      }
    }

    return items;
  }

  return [];
}

function extractSearchMenuItems(
  result: any
): any[] {
  const sc = result?.structuredContent;

  const candidates = [
    sc?.items,
    sc?.menuItems,
    sc?.dishes,
    sc?.results,
    result?.items,
    result?.menuItems,
    result?.dishes,
    result?.results
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c;
    }
  }

  return [];
}

function matchesItem(
  item: any,
  name: string
): boolean {
  const itemName = String(
    item?.name ??
      item?.title ??
      item?.dishName ??
      ""
  ).toLowerCase();

  const target = name.toLowerCase();

  return (
    itemName.includes(target) ||
    target.includes(itemName)
  );
}

function pickByNumberOrName(
  prompt: string,
  list: any[]
): any {
  const num = parseInt(prompt, 10);

  if (
    !isNaN(num) &&
    num >= 1 &&
    num <= list.length
  ) {
    return list[num - 1];
  }

  const lower = prompt
    .trim()
    .toLowerCase();

  return list.find((item: any) => {
    const name = String(
      item?.name ??
        item?.title ??
        item?.restaurantName ??
        item?.dishName ??
        item?.food ??
        ""
    ).toLowerCase();

    return (
      name.includes(lower) ||
      lower.includes(name)
    );
  });
}

function extractVariants(
  item: any
): any[] {
  if (Array.isArray(item.variations)) {
    return item.variations.map((g: any) => ({
      group_id:
        g.group_id ??
        g.groupId,

      name:
        g.name ??
        g.group_name ??
        "",

      variations:
        Array.isArray(g.variations)
          ? g.variations
          : Array.isArray(g.options)
            ? g.options
            : []
    }));
  }

  if (Array.isArray(item.variantsV2)) {
    return item.variantsV2.map((g: any) => ({
      group_id:
        g.group_id ??
        g.groupId,

      name:
        g.name ??
        g.group_name ??
        "",

      variations:
        Array.isArray(g.variations)
          ? g.variations
          : Array.isArray(g.options)
            ? g.options
            : []
    }));
  }

  return [];
}

function pickVariantChoice(
  prompt: string,
  group: any
): any {
  const variations =
    group.variations ?? [];

  const num = parseInt(prompt, 10);

  if (
    !isNaN(num) &&
    num >= 1 &&
    num <= variations.length
  ) {
    return variations[num - 1];
  }

  const lower = prompt
    .trim()
    .toLowerCase();

  return variations.find(
    (v: any) =>
      String(
        v.name ??
          v.variation_name ??
          ""
      )
        .toLowerCase()
        .includes(lower)
  );
}

function formatVariantPrompt(
  group: any
): string {
  const variations =
    group.variations ?? [];

  let out =
    `\nSelect ${
      group.name || "variant"
    }:\n`;

  variations.forEach(
    (v: any, i: number) => {
      out +=
        `${i + 1}. ${
          v.name ??
          v.variation_name ??
          ""
        }${
          v.price
            ? ` — ₹${v.price}`
            : ""
        }\n`;
    }
  );

  return out;
}

function looksLikeCouponQuery(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const lower = prompt.toLowerCase();
  return /\b(coupons?|offers?|discounts?|promo|promos|available coupons?|show coupons?|what coupons? are available)\b/i.test(lower);
}

function getCouponSectionsFromResult(result: any): any[] | undefined {
  const sc = result?.structuredContent ?? result?.data ?? {};
  const sections = Array.isArray(sc?.coupon_sections) ? sc.coupon_sections : undefined;
  return sections;
}

function getApplicableCouponsFromResult(result: any): any[] {
  const sections = getCouponSectionsFromResult(result) ?? [];
  return sections.flatMap((section: any) => {
    const coupons = Array.isArray(section?.coupons) ? section.coupons : [];
    return coupons.filter((coupon: any) => coupon?.applicable === true);
  });
}

function countApplicableCoupons(result: any): number {
  return getApplicableCouponsFromResult(result).length;
}

function formatCouponResult(result: any): string {
  const sc = result?.structuredContent ?? result?.data ?? {};
  const sections = getCouponSectionsFromResult(result) ?? [];

  if (Array.isArray(sections) && sections.length > 0) {
    const lines: string[] = [];
    const summary = sc?.summary ?? {};
    const applicableCoupons = getApplicableCouponsFromResult(result);
    const total = summary?.total_coupons ?? applicableCoupons.length;

    lines.push(`\nAvailable coupons (${total}):`);

    for (const section of sections) {
      const sectionTitle = section?.title ?? "Offers";
      const coupons = Array.isArray(section?.coupons) ? section.coupons : [];
      const applicable = coupons.filter((coupon: any) => coupon?.applicable === true);
      if (applicable.length === 0) continue;

      lines.push(`\n${sectionTitle}:`);

      for (const coupon of applicable) {
        const code = coupon?.title ?? coupon?.code ?? "Coupon";
        const subtitle = coupon?.subtitle ?? "";
        const description = coupon?.description ?? "";
        const ribbonText = coupon?.ribbon_text ?? "";

        lines.push(`- ${code} [✅ APPLICABLE]${subtitle ? ` — ${subtitle}` : ""}`);
        if (ribbonText) lines.push(`  Discount: ${ribbonText}`);
        if (description) lines.push(`  Details: ${description}`);

        const terms = coupon?.terms_and_conditions?.bullet_texts ?? [];
        if (Array.isArray(terms) && terms.length > 0) {
          lines.push("  Terms:");
          for (const term of terms) {
            if (term) lines.push(`    • ${term}`);
          }
        }
      }
    }

    return lines.join("\n");
  }

  const text = Array.isArray(result?.content)
    ? result.content.map((entry: any) => entry?.text ?? "").filter(Boolean).join("\n")
    : "";

  return text || "No coupons were returned by the MCP tool.";
}

function selectDefaultVariants(variants: any[]): any[] {
  return (variants ?? [])
    .map((group: any) => {
      const items = Array.isArray(group?.variations) ? group.variations : Array.isArray(group?.options) ? group.options : [];
      const first = items[0];
      if (!first) return null;

      const variationId = first.variation_id ?? first.variationId ?? first.id ?? first.variation ?? null;
      const groupId = group?.group_id ?? group?.groupId ?? group?.id ?? null;
      if (variationId == null || groupId == null) return null;

      return {
        group_id: groupId,
        variation_id: variationId
      };
    })
    .filter((v: any) => v !== null);
}

function extractCouponCodes(result: any): string[] {
  const sections = Array.isArray(result?.structuredContent?.coupon_sections) ? result.structuredContent.coupon_sections : [];
  const codes: string[] = [];

  for (const section of sections) {
    const coupons = Array.isArray(section?.coupons) ? section.coupons : [];
    for (const coupon of coupons) {
      if (coupon?.applicable !== true) continue;
      const code = coupon?.title ?? coupon?.code ?? coupon?.name;
      if (code) codes.push(String(code));
    }
  }

  return Array.from(new Set(codes.map((code) => code.trim()).filter(Boolean)));
}

function getCouponCodeFromPrompt(prompt: string, knownCodes: string[]): string | null {
  if (!prompt || typeof prompt !== "string") return null;

  const raw = prompt.trim();
  if (!raw) return null;

  const direct = knownCodes.find((code) => code.toLowerCase() === raw.toLowerCase());
  if (direct) return direct;

  const matched = raw.match(/(?:apply|use|coupon|code)\s*[:=]?\s*([A-Za-z0-9]+)/i);
  const candidate = matched?.[1];
  if (!candidate) return null;

  const byName = knownCodes.find((code) => code.toLowerCase() === candidate.toLowerCase());
  return byName ?? null;
}

function extractCouponFailureReason(result: any): string | null {
  const sc = result?.structuredContent ?? result?.data ?? {};
  const candidates: string[] = [];

  if (typeof sc?.reason === "string" && sc.reason.trim()) candidates.push(sc.reason.trim());
  if (typeof sc?.message === "string" && sc.message.trim()) candidates.push(sc.message.trim());
  if (typeof sc?.status_message === "string" && sc.status_message.trim()) candidates.push(sc.status_message.trim());

  const contentText = Array.isArray(result?.content)
    ? result.content.map((entry: any) => entry?.text ?? "").filter(Boolean).join("\n")
    : "";

  if (contentText.trim()) candidates.push(contentText.trim());

  const joined = candidates.join(" ").replace(/\s+/g, " ").trim();
  return joined || null;
}

function formatList(
  list: any[],
  title: string,
  nameKeys: string[]
): string {
  let out =
    `\n==============================\n` +
    `${title}\n` +
    `==============================\n`;

  list.forEach(
    (item: any, i: number) => {
      let name = "";

      for (const k of nameKeys) {
        if (item?.[k]) {
          name = String(item[k]);
          break;
        }
      }

      const price =
        item?.price ??
        item?.priceInfo ??
        "";

      out +=
        `${i + 1}. ${
          name || "<unnamed>"
        }${
          price
            ? ` — ₹${price}`
            : ""
        }\n`;
    }
  );

  return out;
}

function formatMenuMulti(menuItems: any[]): string {
  // Prefix with a marker the frontend recognizes for rendering a checkbox menu.
  let out = "[[MULTI_SELECT_MENU]]\n";

  out += `\n==============================\n` +
    `MENU\n` +
    `==============================\n`;

  menuItems.forEach((item: any, i: number) => {
    const name = item?.name ?? item?.title ?? item?.dishName ?? "<unnamed>";
    const price = item?.price ?? item?.priceInfo ?? "";

    out += `${i + 1}. ${name}${price ? ` — ₹${price}` : ""}\n`;
  });

  // Add a numbered DONE option so the frontend parser recognizes the multi-select block.
  out += `${menuItems.length + 1}. DONE\n`;

  out +=
    "\nSelect the items you want to add.\n" +
    "You can select multiple items.\n" +
    "Click DONE when finished.";

  return out;
}

/**
 * Formats the REAL cart returned by get_food_cart.
 *
 * No prices or fees are hardcoded.
 * Everything comes from the actual MCP response.
 */
function formatCart(
  result: any
): string {
  const sc = result?.structuredContent;

  // Extract cart items robustly from the live response.
  const cart = extractCartItems(result);

  // Use the real pricing data returned by get_food_cart.
  // No amounts are calculated or hardcoded here.
  const pricing =
    sc?.data?.pricing ??
    result?.data?.pricing ??
    {};

  // Offers/discounts are also taken directly from the MCP response.
  const offers =
    sc?.data?.offers ??
    result?.data?.offers ??
    {};

  let out =
    "\n==============================\n" +
    "CART\n" +
    "==============================\n";

  /*
   * CART ITEMS
   *
   * Do not display item?.total/final_price here because those
   * fields can represent a different item-level value from the
   * authoritative cart pricing.item_total.
   *
   * The authoritative monetary breakdown is displayed below
   * from data.pricing.
   */
  if (Array.isArray(cart) && cart.length > 0) {
    cart.forEach((item: any, i: number) => {
      const name =
        item?.name ??
        item?.title ??
        item?.dishName ??
        item?.item_name ??
        `Item ${i + 1}`;

      const qty =
        item?.quantity ??
        item?.qty ??
        "";

      out += `${i + 1}. ${name}` + `${qty !== "" ? ` x${qty}` : ""}\n`;

      // Attempt to display per-item unit price and line total when provided
      const lineTotalRaw = item?.final_price ?? item?.total ?? item?.subtotal ?? item?.amount ?? null;
      const unitPriceRaw = item?.price ?? item?.unit_price ?? item?.rate ?? item?.mrp ?? null;

      const qtyNum = Number(qty);

      let lineTotal = null;
      if (lineTotalRaw !== null && lineTotalRaw !== undefined && lineTotalRaw !== "") {
        const v = Number(lineTotalRaw);
        if (Number.isFinite(v)) lineTotal = v;
      }

      let unitPrice = null;
      if (unitPriceRaw !== null && unitPriceRaw !== undefined && unitPriceRaw !== "") {
        const v = Number(unitPriceRaw);
        if (Number.isFinite(v)) unitPrice = v;
      }

      // If unit price missing but line total is present and qty is numeric, derive unit price
      if (unitPrice == null && lineTotal != null && Number.isFinite(qtyNum) && qtyNum > 0) {
        unitPrice = lineTotal / qtyNum;
      }

      if (unitPrice != null && Number.isFinite(unitPrice) && Number.isFinite(qtyNum) && qtyNum > 0) {
        const computedLine = Math.round(unitPrice * qtyNum * 100) / 100;
        const displayLine = lineTotal != null ? lineTotal : computedLine;
        out += `   ₹${unitPrice} × ${qtyNum} = ₹${displayLine}\n`;
      } else if (lineTotal != null) {
        out += `   Line total: ₹${lineTotal}\n`;
      }
    });
  } else {
    out += "\nNo items found in the live cart response.\n";
  }

  /*
   * PAYMENT DETAILS
   *
   * Every amount below comes directly from the MCP response.
   * We do NOT manually calculate the final amount.
   */
  out +=
    "\n------------------------------\n" +
    "PAYMENT DETAILS\n" +
    "------------------------------\n";

  let hasPricingDetails = false;

  // Authoritative item total from the MCP pricing object.
  if (
    pricing.item_total !== undefined &&
    pricing.item_total !== null
  ) {
    out +=
      `Item Total: ₹${pricing.item_total}\n`;

    hasPricingDetails = true;
  }

  // Actual delivery charge after any delivery discount.
  if (
    pricing.delivery_charge !== undefined &&
    pricing.delivery_charge !== null
  ) {
    out +=
      `Delivery Fee: ₹${pricing.delivery_charge}\n`;

    hasPricingDetails = true;
  }

  // Original delivery charge, only shown as reference.
  // It is NOT added to the final bill.
  if (
    pricing.delivery_charge_strikeoff !== undefined &&
    pricing.delivery_charge_strikeoff !== null &&
    pricing.delivery_charge_strikeoff !== pricing.delivery_charge
  ) {
    out +=
      `Delivery Fee Before Discount: ₹${pricing.delivery_charge_strikeoff}\n`;

    hasPricingDetails = true;
  }

  // The MCP currently exposes this as taxes_and_charges.
  // Do not call the entire amount GST because the MCP has not
  // identified this field as GST specifically.
  if (
    pricing.taxes_and_charges !== undefined &&
    pricing.taxes_and_charges !== null
  ) {
    out +=
      `Taxes & Charges: ₹${pricing.taxes_and_charges}\n`;

    hasPricingDetails = true;
  }

  /*
   * Display additional numeric pricing fields returned by the MCP,
   * such as platform_fee, packaging_charge, convenience_fee, etc.
   *
   * Nothing is invented. If the MCP does not return the field,
   * it will not be displayed.
   */
  const knownPricingFields = new Set([
    "item_total",
    "delivery_charge",
    "delivery_charge_strikeoff",
    "taxes_and_charges",
    "to_pay"
  ]);

  for (const [key, value] of Object.entries(pricing)) {
    if (knownPricingFields.has(key)) {
      continue;
    }

    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    if (
      typeof value !== "number" &&
      typeof value !== "string"
    ) {
      continue;
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      continue;
    }

    const label = formatPricingLabel(key);

    out +=
      `${label}: ₹${value}\n`;

    hasPricingDetails = true;
  }

  // Actual coupon discount returned by the MCP.
  const couponDiscount =
    offers?.coupon_discount;

  if (
    couponDiscount !== undefined &&
    couponDiscount !== null &&
    Number(couponDiscount) !== 0
  ) {
    out +=
      `Discount: -₹${couponDiscount}\n`;

    hasPricingDetails = true;
  }

  /*
   * FINAL AMOUNT
   *
   * This is the authoritative final payable amount returned by
   * the MCP:
   *
   * structuredContent.data.pricing.to_pay
   *
   * We intentionally do not calculate this ourselves.
   */
  if (
    pricing.to_pay !== undefined &&
    pricing.to_pay !== null
  ) {
    out +=
      "------------------------------\n" +
      `TO PAY: ₹${pricing.to_pay}\n`;

    hasPricingDetails = true;
  } else if (!hasPricingDetails) {
    out +=
      "Payment details were not provided by the live cart response.\n";
  }

  out +=
    "\nWould you like to add something else?\n" +
    "1. Yes\n" +
    "2. No\n";

  return out;
}

/**
 * Converts actual MCP pricing field names into
 * readable labels.
 *
 * This does not create or calculate any data.
 */
function formatPricingLabel(
  key: string
): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) =>
      char.toUpperCase()
    );
}

// Try multiple likely paths to find the authoritative cart items array
function extractCartItems(result: any): any[] {
  const sc = result?.structuredContent ?? {};

  const candidates = [
    sc?.data?.items,
    sc?.data?.cart?.items,
    sc?.data?.cart,
    sc?.items,
    result?.data?.items,
    result?.items,
    result?.cart,
    sc?.cart
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }

  // Deep scan: pick first array-of-objects that looks like cart items
  const foundArrays: any[] = [];

  function collect(obj: any) {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") {
        foundArrays.push(v);
      } else if (typeof v === "object") {
        collect(v);
      }
    }
  }

  collect(sc);

  if (foundArrays.length > 0) return foundArrays[0];

  return [];
}

function resolveMenuItemId(item: any): number | string {
  if (!item || typeof item !== "object") return "";

  const raw =
    item.menu_item_id ??
    item.menuItemId ??
    item.menuItem_id ??
    item.id ??
    item.item_id ??
    item.menu_item?.id ??
    (item.id && item.id.toString ? item.id.toString() : undefined) ??
    undefined;

  if (raw === undefined || raw === null || raw === "") return "";

  // If the value is numeric or a numeric string, return as a Number so
  // the MCP receives numeric IDs where expected. Otherwise return string.
  const num = Number(raw);
  if (!Number.isNaN(num) && String(num) === String(raw).replace(/^\s+|\s+$/g, "")) {
    return num;
  }

  return String(raw);
}

// Merge two lists of cart entries (existing baseline + additions).
// Each entry should have `menu_item_id`, `quantity`, and optional `variants`, `variantsV2`, `addons`.
function mergeCartItems(existing: any[], additions: any[]): any[] {
  const map = new Map();

  const keyFor = (e: any) => {
    const id = e?.menu_item_id ?? e?.menuItemId ?? e?.id ?? e?.item_id ?? '';
    const idKey = String(id);
    const v = e?.variants ?? e?.variantsV2 ?? [];
    const a = e?.addons ?? [];
    const vKey = JSON.stringify({ v, a });
    return idKey + '|' + vKey;
  };

  const pushInto = (src: any[]) => {
    for (const e of src || []) {
      if (!e || e.menu_item_id === undefined || e.menu_item_id === null) continue;
      const k = keyFor(e);
      const qty = Number(e.quantity ?? e.qty ?? 0) || 0;
      if (map.has(k)) {
        const cur = map.get(k);
        cur.quantity = (Number(cur.quantity) || 0) + qty;
        map.set(k, cur);
      } else {
        // clone to avoid mutating original
        const copy: any = Object.assign({}, e);
        copy.quantity = qty;
        map.set(k, copy);
      }
    }
  };

  // Start with existing items so they form the baseline
  pushInto(existing);
  // Then add additions (summing quantities for duplicates)
  pushInto(additions);

  return Array.from(map.values());
}

// Build a set of valid menu_item_id strings from session menuItems or by calling get_restaurant_menu
async function buildValidMenuItemIdSet(get: (k: string) => any, service: any): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const menuItems = get("menuItems") ?? [];
    if (Array.isArray(menuItems) && menuItems.length > 0) {
      for (const it of menuItems) {
        const id = resolveMenuItemId(it);
        if (id !== "") set.add(String(id));
      }
      return set;
    }

    // Fallback: try fetching the restaurant menu once
    const restaurantId = get("restaurantId");
    const addressId = get("addressId");
    if (!restaurantId) return set;

    const menuResult: any = await service.callTool("get_restaurant_menu", { addressId, restaurantId, page: 1, pageSize: 50 });
    const items = extractMenuItems(menuResult) ?? [];
    for (const it of items) {
      const id = resolveMenuItemId(it);
      if (id !== "") set.add(String(id));
    }
  } catch (e) {
    // ignore — return whatever we have
  }
  return set;
}