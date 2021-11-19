/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 * Dep是一个可以有多个指令订阅它的可观察测的依赖收集
 */
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = [] //初始化subs实例
  }
  // 添加订阅
  addSub (sub: Watcher) {
    this.subs.push(sub)
  }
  // 删除一个依赖
  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }
  // 添加一个依赖
  depend () {
    if (Dep.target) {
      Dep.target.addDep(this)
    }
  }
  // 通知所有依赖更新
  notify () {
    // stabilize the subscriber list first 首先稳定订阅者列表
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async 如果不运行async订阅者们subs不会在调度中排序
      // we need to sort them now to make sure they fire in correct 我们现在需要对它们进行排序，以确保它们以正常的顺序启动
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated. 正在评估的当前目标监测watcher
// This is globally unique because only one watcher 这是全局唯一的，因为一次只能评估一个观察者
// can be evaluated at a time.
Dep.target = null
const targetStack = []

export function pushTarget (target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}

export function popTarget () {
  targetStack.pop()
  Dep.target = targetStack[targetStack.length - 1]
}
