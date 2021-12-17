/*
 * not type checking this file because flow doesn't play well with  不检查此文件的类型
 * dynamically accessing methods on Array prototype                 因为流不能很好地处理数组原型上的动态访问方法
 */

import { def } from '../util/index'

const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto) //创建了数组的原型上的方法 创建一个对象作为拦截器

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
] // 改变数组自身内容的七个方法

/**
 * Intercept mutating methods and emit events  截获变异方法并发出事件
 */
methodsToPatch.forEach(function (method) {
  // cache original method  缓存原生方法
  const original = arrayProto[method]
  def(arrayMethods, method, function mutator (...args) {
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    if (inserted) ob.observeArray(inserted)
    // notify change 通知改变
    ob.dep.notify()
    return result
  })
})
