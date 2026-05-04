'use strict';

const PortfolioStorage = {
  getJson(key, fallback) {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  },
  setJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  get(key, fallback = null) {
    return localStorage.getItem(key) ?? fallback;
  },
  set(key, value) {
    localStorage.setItem(key, value);
  }
};
