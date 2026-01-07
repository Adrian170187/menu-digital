const App = {
  data: {
    menu: null,
    cart: [],
    orders: [], // Active orders for kitchen
    tables: {}, // { tableId: { items: [], total: 0, status: 'open', adults, children } }
    sales: [],  // Closed transactions for daily report
    totalTables: 10 // Configuration for total tables
  },

  init: async () => {
    await App.loadMenu();
    App.loadState();
    App.initTables();
  },

  initTables: () => {
    // Ensure all tables are initialized in the state if not present
    for (let i = 1; i <= App.data.totalTables; i++) {
      if (!App.data.tables[i]) {
        App.data.tables[i] = { items: [], total: 0, status: 'free', adults: 0, children: 0 };
      }
    }
  },

  loadMenu: async () => {
    try {
      const savedMenu = localStorage.getItem('md_menu');
      let menuData = null;

      // 1. Try LocalStorage
      if (savedMenu && savedMenu !== "null") {
        try {
          menuData = JSON.parse(savedMenu);
        } catch (e) {
          console.error("Error parsing saved menu", e);
        }
      }

      if (menuData && menuData.categories) {
        App.data.menu = menuData;
        console.log("Menu loaded from localStorage");
      } else {
        // 2. Try Fetch (Server/Local File)
        console.log("Fetching menu from server...");
        try {
          const response = await fetch('data/menu.json?v=' + Date.now());
          if (response.ok) {
            const json = await response.json();
            App.data.menu = json;
            localStorage.setItem('md_menu', JSON.stringify(json));
            console.log("Menu loaded from server and saved");
          } else {
            throw new Error("Server response not ok");
          }
        } catch (fetchError) {
          console.warn("Fetch failed (likely CORS or Offline), trying fallback global variable...", fetchError);

          // 3. Try Fallback Global Variable (menu-data.js)
          if (typeof DEFAULT_MENU !== 'undefined') {
            App.data.menu = DEFAULT_MENU;
            localStorage.setItem('md_menu', JSON.stringify(DEFAULT_MENU));
            console.log("Menu loaded from DEFAULT_MENU (fallback)");
          } else {
            throw new Error("No menu source available (LocalStorage empty, Fetch failed, DEFAULT_MENU missing)");
          }
        }
      }
      window.dispatchEvent(new CustomEvent('menu-loaded'));
    } catch (e) {
      console.error("Critical: Failed to load menu", e);
      alert("Error crítico: No se pudo cargar el menú. Por favor recarga la página.");
    }
  },

  loadState: () => {
    const savedOrders = localStorage.getItem('md_orders');
    if (savedOrders) App.data.orders = JSON.parse(savedOrders);

    const savedTables = localStorage.getItem('md_tables');
    if (savedTables) App.data.tables = JSON.parse(savedTables);

    const savedSales = localStorage.getItem('md_sales');
    if (savedSales) App.data.sales = JSON.parse(savedSales);

    // If loadMenu hasn't set it yet, try one last time from localStorage
    if (!App.data.menu) {
      const savedMenu = localStorage.getItem('md_menu');
      if (savedMenu && savedMenu !== "null") {
        try {
          const parsed = JSON.parse(savedMenu);
          if (parsed && parsed.categories) App.data.menu = parsed;
        } catch (e) { }
      }
    }
  },

  saveState: () => {
    localStorage.setItem('md_orders', JSON.stringify(App.data.orders));
    localStorage.setItem('md_tables', JSON.stringify(App.data.tables));
    localStorage.setItem('md_sales', JSON.stringify(App.data.sales));
    localStorage.setItem('md_menu', JSON.stringify(App.data.menu));
    // Trigger storage event for same-tab updates if needed
    window.dispatchEvent(new Event('storage'));
  },

  reloadState: () => {
    App.loadState();
    window.dispatchEvent(new CustomEvent('state-reloaded'));
  },

  // --- Customer / Order Logic ---
  addToCart: (item) => {
    // Check stock before adding to cart
    if (item.stock <= 0) {
      alert(`¡Atención! No hay stock disponible de ${item.name}`);
      return false;
    }

    // Check if enough stock for items already in cart
    const countInCart = App.data.cart.filter(i => i.id === item.id).length;
    if (countInCart >= item.stock) {
      alert(`Solo quedan ${item.stock} unidades de ${item.name} en stock.`);
      return false;
    }

    App.data.cart.push(item);
    window.dispatchEvent(new CustomEvent('cart-updated'));
    return true;
  },

  removeFromCart: (index) => {
    App.data.cart.splice(index, 1);
    window.dispatchEvent(new CustomEvent('cart-updated'));
  },

  placeOrder: (tableId, adults, children) => {
    if (App.data.cart.length === 0) return alert("El carrito está vacío.");

    const totalPax = (parseInt(adults) || 0) + (parseInt(children) || 0);
    if (totalPax <= 0) {
      return alert("Debe ingresar la cantidad de adultos y niños por mesa.");
    }

    // 1. Discount stock
    App.data.cart.forEach(cartItem => {
      App.data.menu.categories.forEach(cat => {
        const menuItem = cat.items.find(i => i.id === cartItem.id);
        if (menuItem) menuItem.stock -= 1;
      });
    });

    // 2. Add to active orders for Kitchen
    const orderId = Date.now();
    const newOrder = {
      id: orderId,
      tableId: tableId,
      items: [...App.data.cart],
      status: 'pending',
      timestamp: new Date().toISOString()
    };
    App.data.orders.push(newOrder);

    // 3. Add to Table tab (for Cashier)
    if (!App.data.tables[tableId] || App.data.tables[tableId].status === 'free') {
      App.data.tables[tableId] = { items: [], total: 0, status: 'occupied', adults: 0, children: 0 };
    }

    App.data.tables[tableId].items.push(...App.data.cart);
    App.data.tables[tableId].total += App.data.cart.reduce((sum, item) => sum + item.price, 0);
    App.data.tables[tableId].adults = parseInt(adults) || 0;
    App.data.tables[tableId].children = parseInt(children) || 0;
    App.data.tables[tableId].status = 'occupied';

    // 4. Clear Cart & Save
    App.data.cart = [];
    App.saveState();

    alert(`Pedido enviado a cocina para Mesa ${tableId}!`);
    window.dispatchEvent(new CustomEvent('order-placed'));
  },

  // --- Kitchen Logic ---
  markOrderReady: (orderId) => {
    const order = App.data.orders.find(o => o.id === orderId);
    if (order) {
      order.status = 'ready';
      App.saveState();
      window.dispatchEvent(new CustomEvent('orders-updated'));
    }
  },

  // --- Cashier Logic ---
  updateStock: (itemId, newStock) => {
    let found = false;
    App.data.menu.categories.forEach(cat => {
      const item = cat.items.find(i => i.id === itemId);
      if (item) {
        item.stock = parseInt(newStock) || 0;
        found = true;
      }
    });

    if (found) {
      App.saveState();
      window.dispatchEvent(new CustomEvent('menu-updated'));
      return true;
    }
    return false;
  },

  getBeverageStockReport: () => {
    const bevCat = App.data.menu.categories.find(c => c.id === 'beverages');
    if (!bevCat) return [];

    // Calculate how many of each beverage were sold today
    const salesReport = App.getItemsSoldReport();

    return bevCat.items.map(item => ({
      name: item.name,
      currentStock: item.stock,
      soldToday: salesReport[item.name]?.quantity || 0,
      totalStock: item.stock + (salesReport[item.name]?.quantity || 0)
    }));
  },

  closeTable: (tableId) => {
    const table = App.data.tables[tableId];
    if (!table || table.status === 'free') {
      console.warn(`Cannot close table ${tableId}: Table not found or is free.`);
      return false;
    }

    // Logic executes immediately - confirmation is handled by UI
    App.data.sales.push({
      id: Date.now(),
      tableId: tableId,
      items: [...table.items],
      total: table.total,
      adults: table.adults || 0,
      children: table.children || 0,
      timestamp: new Date().toISOString()
    });

    // Clear/Free table
    App.data.tables[tableId] = { items: [], total: 0, status: 'free', adults: 0, children: 0 };

    // Clean up orders for this table
    App.data.orders = App.data.orders.filter(o => o.tableId != tableId);

    App.saveState();
    window.dispatchEvent(new CustomEvent('tables-updated'));
    window.dispatchEvent(new CustomEvent('orders-updated'));
    console.log(`Table ${tableId} closed successfully.`);
    return true;
  },

  closeDay: () => {
    if (confirm("¿Estás seguro de cerrar el día? Esto borrará el historial de ventas, pedidos y liberará todas las mesas.")) {
      App.data.sales = [];
      App.data.orders = [];
      // Reset all tables to free
      for (let i = 1; i <= App.data.totalTables; i++) {
        App.data.tables[i] = { items: [], total: 0, status: 'free', adults: 0, children: 0 };
      }

      App.saveState();
      window.dispatchEvent(new CustomEvent('sales-updated'));
      window.dispatchEvent(new CustomEvent('tables-updated'));
      window.dispatchEvent(new CustomEvent('orders-updated'));
      alert("Día cerrado. Se han reiniciado las mesas y ventas.");
    }
  },

  getItemsSoldReport: () => {
    const report = {};
    App.data.sales.forEach(sale => {
      sale.items.forEach(item => {
        if (!report[item.name]) {
          report[item.name] = { quantity: 0, total: 0 };
        }
        report[item.name].quantity += 1;
        report[item.name].total += item.price;
      });
    });
    return report;
  },

  formatCurrency: (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
  },

  // --- Auth Logic ---
  auth: {
    login: (username, password, targetRole) => {
      // Hardcoded password for simplicity as requested
      if (password === '1234') {
        const session = {
          user: username,
          role: targetRole,
          timestamp: Date.now()
        };
        localStorage.setItem('md_session', JSON.stringify(session));
        return true;
      }
      return false;
    },

    logout: () => {
      localStorage.removeItem('md_session');
      window.location.href = 'index.html';
    },

    require: (requiredRole) => {
      const sessionStr = localStorage.getItem('md_session');
      if (!sessionStr) {
        window.location.href = 'index.html';
        return;
      }

      const session = JSON.parse(sessionStr);
      // specific role check can be added here if we want strict separation
      // for now, just checking if logged in is enough for valid password
      if (!session.role) {
        window.location.href = 'index.html';
      }
    },

    check: () => {
      const sessionStr = localStorage.getItem('md_session');
      if (sessionStr) {
        // Already logged in
      }
    }
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  // If we are on a protected page, check auth immediately
  if (document.body.dataset.role) {
    App.auth.require(document.body.dataset.role);
  }
  App.init();
});
