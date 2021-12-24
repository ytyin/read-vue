/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 *
 *  在Vue中，把DOM-Diff过程叫做patch过程。patch意为“补丁”，即指对旧的VNode的修补，打补丁从而得到新的VNode。
 *  要以生成的新的VNode为基准，对比旧的oldVnode: 如果新的VNode上有的节点而旧的oldNode上没有，那么就在旧的oldVNode上加上去；
 *  如果新的VNode上没有的节点而旧的oldVNode上有，那么就在旧的oldVNode上去掉；如果某些节点在新的VNode和旧的VNode上都有，那么就以新的VNode为准，更新旧的oldVNode，从而让新旧VNode相同。
 *
 *  总之：以新的VNode为基准，改造旧的oldVNode使之成为跟新的VNode一样，这就是patch过程要干的事。
 *
 *  整个pctch过程干的三件事情如下：
 *  ·创建节点：新的VNode中有而旧的oldVNode没有，就在旧的oldVNode中创建
 *  ·删除节点：新的VNode中没有而旧的oldVNode中有，就从旧的oldVNode中删除
 *  ·更新节点：新的VNode和旧的oldVNode都有，就以新的VNode为准，更新旧的oldVNode
 */

import VNode, { cloneVNode } from './vnode'
import config from '../config'
import { SSR_ATTR } from 'shared/constants'
import { registerRef } from './modules/ref'
import { traverse } from '../observer/traverse'
import { activeInstance } from '../instance/lifecycle'
import { isTextInputType } from 'web/util/element'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive
} from '../util/index'

export const emptyNode = new VNode('', {}, [])

const hooks = ['create', 'activate', 'update', 'remove', 'destroy']

function sameVnode (a, b) {
  return (
    a.key === b.key &&
    a.asyncFactory === b.asyncFactory && (
      (
        a.tag === b.tag &&
        a.isComment === b.isComment &&
        isDef(a.data) === isDef(b.data) &&
        sameInputType(a, b)
      ) || (
        isTrue(a.isAsyncPlaceholder) &&
        isUndef(b.asyncFactory.error)
      )
    )
  )
}

function sameInputType (a, b) {
  if (a.tag !== 'input') return true
  let i
  const typeA = isDef(i = a.data) && isDef(i = i.attrs) && i.type
  const typeB = isDef(i = b.data) && isDef(i = i.attrs) && i.type
  return typeA === typeB || isTextInputType(typeA) && isTextInputType(typeB)
}

function createKeyToOldIdx (children, beginIdx, endIdx) {
  let i, key
  const map = {}
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key
    if (isDef(key)) map[key] = i
  }
  return map
}

export function createPatchFunction (backend) {
  let i, j
  const cbs = {}

  const { modules, nodeOps } = backend  // 代码中的nodeOps是Vue为了跨平台兼容性，对所有节点操作进行了封装，例如nodeOps.createTextNode()在浏览器端等同于document.createTextNode()

  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = []
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]])
      }
    }
  }

  function emptyNodeAt (elm) {
    return new VNode(nodeOps.tagName(elm).toLowerCase(), {}, [], undefined, elm)
  }

  function createRmCb (childElm, listeners) {
    function remove () {
      if (--remove.listeners === 0) {
        removeNode(childElm)
      }
    }
    remove.listeners = listeners
    return remove
  }

  function removeNode (el) {
    const parent = nodeOps.parentNode(el)  // 获取父节点
    // element may have already been removed due to v-html / v-text 元素可能已经被v-html/v-text删除
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el) // 调用父节点的removeChild方法
    }
  }

  function isUnknownElement (vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some(ignore => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    )
  }

  let creatingElmInVPre = 0

  function createElm (
    vnode,
    insertedVnodeQueue,
    parentElm,
    refElm,
    nested,
    ownerArray,
    index
  ) {
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!  此vnode已在以前的渲染中使用
      // now it's used as a new node, overwriting its elm would cause     现在它被用作新节点，当它被用作插入引用节点时，覆盖它的elm将导致潜在的修补程序错误。
      // potential patch errors down the road when it's used as an insertion    相反，我们在为节点创建关联的DOM元素之前按需克隆节点
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    vnode.isRootInsert = !nested // for transition enter check 对于转换，输入check
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return
    }

    const data = vnode.data
    const children = vnode.children
    const tag = vnode.tag
    if (isDef(tag)) {
      if (process.env.NODE_ENV !== 'production') {
        if (data && data.pre) {
          creatingElmInVPre++
        }
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          warn(
            'Unknown custom element: <' + tag + '> - did you ' +
            'register the component correctly? For recursive components, ' +
            'make sure to provide the "name" option.',
            vnode.context
          )
        }
      }

      vnode.elm = vnode.ns
        ? nodeOps.createElementNS(vnode.ns, tag)
        : nodeOps.createElement(tag, vnode)  // 创建元素节点
      setScope(vnode)

      /* istanbul ignore if */ // 伊斯坦布尔 忽略if
      if (__WEEX__) {
        // in Weex, the default insertion order is parent-first.    在Weex中，默认的插入顺序是父级优先
        // List items can be optimized to use children-first insertion    可以使用append='tree'对列表项进行优化，以使用子项优先插入
        // with append="tree".
        const appendAsTree = isDef(data) && isTrue(data.appendAsTree)
        if (!appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
        createChildren(vnode, children, insertedVnodeQueue) // 创建元素节点的子节点
        if (appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)  // 插入到DOM中
        }
      } else {
        createChildren(vnode, children, insertedVnodeQueue)
        if (isDef(data)) {
          invokeCreateHooks(vnode, insertedVnodeQueue)
        }
        insert(parentElm, vnode.elm, refElm)
      }

      if (process.env.NODE_ENV !== 'production' && data && data.pre) {
        creatingElmInVPre--
      }
    } else if (isTrue(vnode.isComment)) {
      vnode.elm = nodeOps.createComment(vnode.text) // 创建注释节点
      insert(parentElm, vnode.elm, refElm)  // 插入到DOM中
    } else {
      vnode.elm = nodeOps.createTextNode(vnode.text) // 创建文本节点
      insert(parentElm, vnode.elm, refElm)  // 插入到DOM中
    }
  }
  /**
   * ·判断是否为元素节点只需要判断该Node节点是否有tag标签即可。如果有tag属性即认为是元素节点，则调用createElement方法创建元素节点，通常元素节点还会有子节点，
   *  那就递归遍历创建所有子节点，将所有子节点创建好之后insert插入到当前元素节点里面，最后把当前元素节点插入到DOM中。
   * ·判断是够味注释节点只需要判断VNode的isComment属性是否为true即可，若为true则注释节点，则调用creatComment方法创建注释节点，再插入到DOM中。
   * ·如果既不是元素节点也不是注释节点，那就认为是文本节点，则调用createTextNode方法创建文本节点，再插入到DOM中。
   *
   * 流程入下：
   * 创建节点 if(VNode是元素节点){ 创建元素节点 }else{ if(VNode是注释节点){ 创建注释节点 }else{ 创建文本节点 } }   插入到DOM中
   */

  function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data
    if (isDef(i)) {
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
      if (isDef(i = i.hook) && isDef(i = i.init)) {
        i(vnode, false /* hydrating */)
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      if (isDef(vnode.componentInstance)) {
        initComponent(vnode, insertedVnodeQueue)
        insert(parentElm, vnode.elm, refElm)
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
        }
        return true
      }
    }
  }

  function initComponent (vnode, insertedVnodeQueue) {
    if (isDef(vnode.data.pendingInsert)) {
      insertedVnodeQueue.push.apply(insertedVnodeQueue, vnode.data.pendingInsert)
      vnode.data.pendingInsert = null
    }
    vnode.elm = vnode.componentInstance.$el
    if (isPatchable(vnode)) {
      invokeCreateHooks(vnode, insertedVnodeQueue)
      setScope(vnode)
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode)
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode)
    }
  }

  function reactivateComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode
      if (isDef(i = innerNode.data) && isDef(i = i.transition)) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode)
        }
        insertedVnodeQueue.push(innerNode)
        break
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm)
  }

  function insert (parent, elm, ref) {
    if (isDef(parent)) {
      if (isDef(ref)) {
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref)
        }
      } else {
        nodeOps.appendChild(parent, elm)
      }
    }
  }

  function createChildren (vnode, children, insertedVnodeQueue) {
    if (Array.isArray(children)) {
      if (process.env.NODE_ENV !== 'production') {
        checkDuplicateKeys(children)
      }
      for (let i = 0; i < children.length; ++i) {
        createElm(children[i], insertedVnodeQueue, vnode.elm, null, true, children, i)
      }
    } else if (isPrimitive(vnode.text)) {
      nodeOps.appendChild(vnode.elm, nodeOps.createTextNode(String(vnode.text)))
    }
  }

  function isPatchable (vnode) {
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode
    }
    return isDef(vnode.tag)
  }

  // 调用创建钩子
  function invokeCreateHooks (vnode, insertedVnodeQueue) {
    for (let i = 0; i < cbs.create.length; ++i) {
      cbs.create[i](emptyNode, vnode)
    }
    i = vnode.data.hook // Reuse variable 重用变量
    if (isDef(i)) {
      if (isDef(i.create)) i.create(emptyNode, vnode)
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode)
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
  function setScope (vnode) {
    let i
    if (isDef(i = vnode.fnScopeId)) {
      nodeOps.setStyleScope(vnode.elm, i)
    } else {
      let ancestor = vnode
      while (ancestor) {
        if (isDef(i = ancestor.context) && isDef(i = i.$options._scopeId)) {
          nodeOps.setStyleScope(vnode.elm, i)
        }
        ancestor = ancestor.parent
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    if (isDef(i = activeInstance) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef(i = i.$options._scopeId)
    ) {
      nodeOps.setStyleScope(vnode.elm, i)
    }
  }

  function addVnodes (parentElm, refElm, vnodes, startIdx, endIdx, insertedVnodeQueue) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(vnodes[startIdx], insertedVnodeQueue, parentElm, refElm, false, vnodes, startIdx)
    }
  }

  function invokeDestroyHook (vnode) {
    let i, j
    const data = vnode.data
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.destroy)) i(vnode)
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode)
    }
    if (isDef(i = vnode.children)) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j])
      }
    }
  }

  /**
   * 删除节点
   */
  function removeVnodes (vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx]  // 获取节点
      if (isDef(ch)) {
        if (isDef(ch.tag)) { // 元素节点
          removeAndInvokeRemoveHook(ch) // 调用节点的removeAndInvokeRemoveHook方法
          invokeDestroyHook(ch)
        } else { // Text node  文本节点
          removeNode(ch.elm) // 移除节点
        }
      }
    }
  }

  function removeAndInvokeRemoveHook (vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i
      const listeners = cbs.remove.length + 1
      if (isDef(rm)) {
        // we have a recursively passed down rm callback  我们有一个递归传递的rm回调函数，用于增加侦听器计数
        // increase the listeners count
        rm.listeners += listeners
      } else {
        // directly removing  直接移除
        rm = createRmCb(vnode.elm, listeners)
      }
      // recursively invoke hooks on child component root node 递归调用子组件根节点上的钩子
      if (isDef(i = vnode.componentInstance) && isDef(i = i._vnode) && isDef(i.data)) {
        removeAndInvokeRemoveHook(i, rm)
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm)
      }
      if (isDef(i = vnode.data.hook) && isDef(i = i.remove)) {
        i(vnode, rm)
      } else {
        rm()
      }
    } else {
      removeNode(vnode.elm)
    }
  }

  /**
   * 更新子节点:
   * 当新的VNode与旧的oldVNode都是元素节点并且都包含子节点时，那么这两个节点的VNode实例上的children属性就是所包含的子节点数组。我们把新的VNode上的子节点数组记为newChildren,
   * 把旧的oldVNode上的子节点数组记为oldChildren,我们把newChildren里面的元素与oldChildren里的元素一一对比，对比两个子节点数组肯定是要通过循环。外层循环newChildren数组，
   * 内层循环oldChildren数组。每循环外层newChildren数组里的一个子节点，就去内层oldChildren数组里找看有没有与之相同的子节点。伪代码如下：
   * for (let i = 0; i < newChildren.length; i++) {
   *  const newChild = newChildren[i];
   *  for (let j = 0; j < oldChildren.length; j++) {
   *    const oldChild = oldChildren[j];
   *    if (newChild === oldChild) {
   *      // ...
   *    }
   *  }
   * }
   * 那么以上这个过程将会存在以下四种情况
   * ·创建子节点
   *  如果newChildren里面的某个子节点在oldChildren里找不到与之相同的子节点，那么说明newChildren里面的每一个子节点是之前没有的，是需要此次新增的姐弟那，那么就创建子节点
   *  创建好之后再把它插入到DOM中 “合适的位置” 合适的位置就是所有未处理节点之前，而并非所有已处理节点之后
   * ·删除子节点
   *  如果newChildren里面每一个子节点都循环完毕后，发现在oldChildren还有未处理的子节点，那就说明这些未处理的子节点是需要被废弃的，那么就将这些节点删除
   * ·移动子节点
   *  如果newChildren里面的某个子节点在oldChildren里找到了与之相同的子节点，但是所处的位置不同，这说明此次变化需要调整该子节点的位置，那就以newChildren里子节点的位置为基准，
   *  调整oldChildren里该节点的位置，使之与newChildren里的位置相同
   *  所有未处理节点之前就是我们要移动的目的位置
   * ·更新节点
   *  如果newChildren里面的某个子节点在oldChildren里找到了与之相同的子节点，并且所处的位置也相同，那么就更新oldChildren里该节点，使之与newChildren里的该节点相同
   *
   * 以上先外层循环newChildren数组，再内层循环oldChildren数组，每循环外层newChildren数组里的一个子节点，就去内层oldChildren数组里找看有没有与之相同的子节点，
   * 最后根据不同的情况做出不同的操作
   * 这种方法虽然能解决问题，但是还存在可优化的地方。比如当包含的子节点数量很多时，这样循环算法的时间复杂度救护变得很大，不利于性能提升。Vue中关于子节点更新的优化问题，
   * 做法如下
   * 优化策略介绍
   * 假设有一份新的newChildren数组和旧的oldChildren数组，如下所示：
   * newChildren = ['新子节点1‘,'新子节点2‘,'新子节点3‘,'新子节点4‘]
   * oldChildren = ['旧子节点1‘,'旧子节点2‘,'旧子节点3‘,'旧子节点4‘]
   * 优化点在于不要按顺序去循环newChildren和oldChildren这两个数组，可以先比较这两个数组里特殊位置的子节点，比如：
   * ·先把newChildren数组里的所有未处理子节点的第一个子节点和oldChildren数组里所有未处理子节点的第一个子节点做对比，如果相同，那就直接进入更新节点的操作
   * ·如果不同，再把newChildren数组里所有未处理子节点的最后一个子节点和oldChildren数组里所有未处理子节点的最后一个子节点做比对，如果相同，那就直接进入更新节点的操作
   * ·如果不同，再把newChildren数组里所有未处理子节点的最后一个子节点和oldChildren数组里所有未处理子节点的第一个子节点做比对，如果相同，那就直接进入更新节点的操作，
   *  更新完后再将oldChildren数组里的该节点移动到与newChildren数组里节点相同的位置
   * ·如果不同，再把newChildren数组里所有未处理子节点的的第一个子节点和oldChildren数组里所有未处理子节点的最后一个子节点做比对，如果相同，那就直接进入更新节点的操作，
   *  更新完后再将oldChildren数组里该节点移动到与newChildren数组里节点相同的位置
   * ·最后四种情况都试完如果还不同，那就按照之前循环的方式来查找节点
   * 我们把：
   *  newChildren数组里所有未处理子节点的第一个子节点称为：新前；
   *  newChildren数组里所有未处理子节点的最后一个子节点称为：新后；
   *  oldChildren数组里所有未处理子节点的第一个子节点称为：旧前；
   *  oldChildren数组里所有未处理子节点的最后一个子节点称为：旧后；
   * 于是上述描述的 更新优化策略的4种情况 过程可以如下图：
   * newChildren  (新前) () () (新后)
   * oldChildren  (旧前) () () (旧后)
   * （1）新前 ---> 旧前  如果相同，更新节点，位置相同，无需移动；如果不同，再尝试后面三种情况
   * （2）新后 ---> 旧后  如果相同，更新节点，位置相同，无需移动；如果不同，再尝试后面两种情况
   * （3）新后 ---> 旧前  如果相同，更新节点，移动位置（移动节点的操作的关键在于要找准要移动的位置。更新节点要以新VNode为基准，然后操作旧的oldVNode，使之最后旧的oldVNode与新的VNode相同）；
   *                    从图中不难看出，需要把oldChildren数组里把第一个子节点移动到数组中 所有未处理节点 之后，也就是移动到最后一个子节点的位置；
   *                    如果不同，再尝试最后一种情况
   * （4）新前 ---> 旧后  如果相同，更新节点，移动位置，需要把oldChildren数组里把最后一个子节点移动到数组中 所有未处理节点 之前，也就是移动到第一个子节点的位置；
   *                    如果不同，那就再通过之前的循环方式查找
   * 关于优化策略
   * 我们应该有这样一个概念：那就是我们前面所说的优化策略中，节点有可能是从前面对比，也可能是从后面对比，对比成功就会进行更新处理，也就是说我们有可能处理第一个，也有可能处理最后一个，
   * 那么我们在循环的时候就不能简单从前往后或者从后往前循环，而是要从两边向中间循环
   * 如下图：
   * newChildren  (newStartIdx) (-->) (...) (<--) (newEndIdx)
   * oldChildren  (oldStartIdx) (-->) (...) (<--) (oldEndIdx)
   * 首先，我们先准备4个变量：
   * newStartIdx: newChildren数组里开始位置的下标
   * newEndIdx: newChildren数组里结束位置的下标
   * oldStartIdx: oldChildren数组里开始位置的下标
   * oldEndIdx: oldChidren数组里结束位置的下标
   * 在循环的时候，每处理一个节点，就将下标向图中箭头所指的方向移动一个位置，开始位置所表示的节点被处理后，就向后移动一个位置；结束位置所表示的节点被处理后，就向前移动一个位置；
   * 由于我们的优化策略都是新旧节点两两更新的，所以一次更新将会移动两个节点。说的再直白一点就是：newStartIdx 和 oldStartIdx 只能往后移动（只会加），newEndIdx和oldEndIdx只能往前移动（只会减）
   * 当开始位置大于结束位置时，表示所有节点都已经遍历过了
   */

  function updateChildren (parentElm, oldCh, newCh, insertedVnodeQueue, removeOnly) {
    let oldStartIdx = 0 // oldChildren开始索引 --- 旧前索引
    let newStartIdx = 0 // newChildren开始索引 --- 新前索引
    let oldEndIdx = oldCh.length - 1 // oldChildren结束索引 --- 旧后索引
    let oldStartVnode = oldCh[0] // oldChildren中所有未处理节点中的第一个  --- 旧前
    let oldEndVnode = oldCh[oldEndIdx] // oldChildren中所有未处理节点中的最后一个 --- 旧后
    let newEndIdx = newCh.length - 1 // newChildren结束索引 --- 新后索引
    let newStartVnode = newCh[0] // newChildren中所有未处理节点中的第一个  --- 新前
    let newEndVnode = newCh[newEndIdx] // newChildren中所有未处理节点中的最后一个  --- 新后
    let oldKeyToIdx, idxInOld, vnodeToMove, refElm

    // removeOnly is a special flag used only by <transition-group>   removeOnly是一个特殊标志，仅由<transition-group>使用
    // to ensure removed elements stay in correct relative positions   以确保在离开转换期间被删除的元素保持在正确的相对位置
    // during leaving transitions
    const canMove = !removeOnly

    if (process.env.NODE_ENV !== 'production') {
      checkDuplicateKeys(newCh)
    }

    // 以“新前”、“新后”、“旧前”、“旧后”的方式开始比对节点
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (isUndef(oldStartVnode)) { // 如果oldStartVnode不存在，则直接跳过，对比下一个
        oldStartVnode = oldCh[++oldStartIdx] // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) { // 如果oldEndVnode不存在，则之前跳过，对比前一个
        oldEndVnode = oldCh[--oldEndIdx]
      } else if (sameVnode(oldStartVnode, newStartVnode)) { // 如果新前与旧前节点相同，就把两个节点进行patch更新，同时oldStartIdx和newStartIdx都加1，后移一个位置
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        oldStartVnode = oldCh[++oldStartIdx]
        newStartVnode = newCh[++newStartIdx]
      } else if (sameVnode(oldEndVnode, newEndVnode)) { // 如果新后与旧后节点相同，就把两个节点进行patch更新，同时oldEndIdx和newEndIdx都减1，前移一个位置
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        oldEndVnode = oldCh[--oldEndIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldStartVnode, newEndVnode)) { // Vnode moved right
        //如果新后与旧前相同，就先把两个节点进行patch更新，然后把旧前节点移动到oldChildren中所有未处理节点之后，最后把oldStartIdx加1，后移一个位置，newEndIdx减1，前移一个位置
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        canMove && nodeOps.insertBefore(parentElm, oldStartVnode.elm, nodeOps.nextSibling(oldEndVnode.elm))
        oldStartVnode = oldCh[++oldStartIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldEndVnode, newStartVnode)) { // Vnode moved left
        //如果新前与旧后相同，就先把两个节点进行patch更新，然后把旧后节点移动到oldChildren中所有未处理节点之前，最后把oldEndIdx减1，前移一个位置，newEndIdx加1，后移一个位置
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        canMove && nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm)
        oldEndVnode = oldCh[--oldEndIdx]
        newStartVnode = newCh[++newStartIdx]
      } else { // 如果不属于以上四种情况，就进行常规的循环对比patch
        if (isUndef(oldKeyToIdx)) oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx)
        idxInOld = isDef(newStartVnode.key)
          ? oldKeyToIdx[newStartVnode.key]
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx)
        /**
         * 更新子节点 之 创建子节点/删除子节点/移动子节点/更新节点
         *  创建子节点
         */
        if (isUndef(idxInOld)) { // New element  如果在oldChildren里找不到当前循环到newChildren里的子节点
          createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx) // 新增节点并插入到合适位置
        } else {
          vnodeToMove = oldCh[idxInOld] // 如果在oldChildren里找到了当前循环的newChildren里的子节点
          if (sameVnode(vnodeToMove, newStartVnode)) { // 如果两个节点相同
            patchVnode(vnodeToMove, newStartVnode, insertedVnodeQueue, newCh, newStartIdx) // 调用patchVNode更新节点
            oldCh[idxInOld] = undefined
            canMove && nodeOps.insertBefore(parentElm, vnodeToMove.elm, oldStartVnode.elm)
            // canMove表示是否需要移动节点，如果为true表示需要移动，则移动节点，如果为false则不用移动
          } else {
            // same key but different element. treat as new element
            createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
          }
        }
        /**
         * 以上代码中，首先判断在oldChildren里能否找到当前循环的newChildren里的子节点，如果找不到，那就是新增节点并插入到合适的位置；
         * 如果找到了，先对比两个节点是否相同，若相同则先调用patchVnode更新节点，更新完之后再看是否需要移动节点
         */
        newStartVnode = newCh[++newStartIdx]
      }
    }
    if (oldStartIdx > oldEndIdx) {
      // 如果oldChilidren比newChildren先循环完毕，那么newChildren里面剩余的节点都是需要新增的节点，把[newStartIdx, newEndIdx]之间的所有节点都插入到DOM中
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm
      addVnodes(parentElm, refElm, newCh, newStartIdx, newEndIdx, insertedVnodeQueue)
    } else if (newStartIdx > newEndIdx) {
      // 如果newChildren比oldChildren先循环完毕，那么oldChildren里面剩余的节点都是需要删除的节点，把[oldStartIdx, oldEndIdx]之间的所有节点都删除
      removeVnodes(oldCh, oldStartIdx, oldEndIdx)
    }
  }
  /**
   * 以上介绍了Vue中子节点更新的优化策略，发现Vue为了避免双重循环数据大时间复杂度高带来的性能问题，而选择了从子节点数组中的4个特殊位置互相比对，
   * 分别是：新前与旧前，新后与旧后，新后与旧前，新前与旧后。对于每一种情况我们都通过图文的形式对其逻辑进行了分析。
   * 以上就是Vue中patch过程，即DOM-Diff算法所有内容了。
   */

  function checkDuplicateKeys (children) {
    const seenKeys = {}
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i]
      const key = vnode.key
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          )
        } else {
          seenKeys[key] = true
        }
      }
    }
  }

  function findIdxInOld (node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i]
      if (isDef(c) && sameVnode(node, c)) return i
    }
  }

  /**
   * 更新节点 就是当某些节点在新的VNode和旧的VNode中都有时，我们就需要细致对比一下，找出不一样的地方进行更新
   * <p>我是不会变化的文字</p>
   * 以上节点只包含了纯文字，没有任何可变的变量，这也就是说，不管数据再怎么变化，只要这个节点第一次渲染了，那么它以后就永远不会发生变化，这是因为它不包含任何变量，
   * 所以数据发生任何变化都与它无关。我们把这种节点称之为静态节点
   * 更新节点的时候需要对以下三种情况进行判断并分别处理：
   * 1.如果VNode和oldVNode均为静态节点
   *   我们说了，静态节点数据无论发生任何变化都与它无关，所以都为静态节点的话则直接跳过，无需处理
   * 2.如果VNode是文本节点
   *   如果VNode是文本节点，即表示这个节点内只包含纯文本，那么只需要看oldVNode是否也是文本节点，如果是，那就比较两个文本是否不同，
   *   如果不同则把oldVNode里的文本该成和VNode的文本一样。如果oldVNode不是文本节点，那么不论它是什么，直接调用setText方法把它改成文本节点，并且文本内容根VNode相同。
   * 3.如果VNode是元素节点 则又细分以下两种情况：
   *   该节点包含子节点：
   *     如果新的节点内包含了子节点，那么此时要看旧的节点是否包含子节点，如果旧的节点里也包含了子节点，那就需要递归对比更新子节点；
   *     如果旧的节点里不包含子节点，那么这个旧节点有可能是空节点或是文本节点，
   *     如果旧的节点是空节点就把新的节点里的子节点创建一份然后插入到旧的节点里面，如果旧的节点是文本节点，则把文本清空，然后把新的节点里的子节点创建一份谈后插入到旧的节点里面
   *   该节点不包含子节点：
   *     如果该节点不包含子节点，同时它又不是文本节点，那就说明该节点是个空节点，那就好办了，不管旧节点之前里面都有啥，直接清空即可
   *
   * 处理完以上3种情况，更新节点就算基本完成了。
   * */
  function patchVnode (
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray,
    index,
    removeOnly
  ) {
    if (oldVnode === vnode) {
      return // vnode和oldVnode是否完全一样？若是，退出程序
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode   克隆可复用的vnode
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    const elm = vnode.elm = oldVnode.elm

    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue)
      } else {
        vnode.isAsyncPlaceholder = true
      }
      return // vnode与oldVnode是否都是静态节点？若是，退出程序
    }

    // reuse element for static trees.   重用静态树的元素
    // note we only do this if the vnode is cloned -          注意，我们仅在克隆vnode时才执行此操作---
    // if the new node is not cloned it means the render functions have been   如果未克隆新节点，则表示渲染函数已由热更新重新加载api配置
    // reset by the hot-reload-api and we need to do a proper re-render.     我们需要执行适当的重新渲染。
    if (isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      vnode.componentInstance = oldVnode.componentInstance
      return
    }

    let i
    const data = vnode.data
    if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
      i(oldVnode, vnode)
    }

    const oldCh = oldVnode.children
    const ch = vnode.children
    if (isDef(data) && isPatchable(vnode)) {
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode)
      if (isDef(i = data.hook) && isDef(i = i.update)) i(oldVnode, vnode)
    }
    if (isUndef(vnode.text)) {  // vnode有text属性？若没有：
      if (isDef(oldCh) && isDef(ch)) { // vnode的子节点与oldVnode的子节点是否都存在？
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly) // 若都存在，判断子节点是否相同，不同则更新子节点
      } else if (isDef(ch)) {  // 若只有vnode的子节点存在
        if (process.env.NODE_ENV !== 'production') {
          checkDuplicateKeys(ch)
        }
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, '') // 判断oldVnode是否有文本？若有，则清空DOM中的文本，再把vnode的子节点添加到真实DOM中
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue) // 若没有，则把vnode的子节点添加到真实DOM中
      } else if (isDef(oldCh)) { // 若只有oldnode的子节点存在
        removeVnodes(oldCh, 0, oldCh.length - 1) // 清空dom中的子节点
      } else if (isDef(oldVnode.text)) { // 若vnode和oldnode都没有子节点，但是oldnode中有文本
        nodeOps.setTextContent(elm, '') // 清空oldnode文本
      } // 上面两个判断一句话概括就是，如果vnode中既没有text，也没有子节点，那么对应的oldnode中有什么就清空什么
    } else if (oldVnode.text !== vnode.text) {  // 若有，vnode的text属性与oldVnode的text属性是否相同？
      nodeOps.setTextContent(elm, vnode.text) // 若不相同，则用vnode的text替换真是DOM的文本
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.postpatch)) i(oldVnode, vnode)
    }
  }
  /**
   * 上面代码里的注释写得很清晰了，流程图梳理一下流程是：
   * 更新节点 if(VNode与oldVNode完全一样){ 退出程序 }
   *         else if(VNode与oldVNode都是静态节点){ 退出程序 }
   *         else if(VNode有text属性){ if(VNode与oldVNode的文本不同){用VNode的文本替换真实dom中的内容} }
   *         else if(VNode与oldVNode都有子节点){ if(VNode与oldVNode的子节点不同){ 更新子节点 }}
   *         else if(只有VNode有子节点){ if(oldVNode有文本){ 清空DOM中的文本 }else{ 把VNode的子节点添加到DOM中 }}
   *         else if(只有oldVNode有子节点){ 清空DOM中的文本 }
   *
   * 介绍了Vue中DOM-Diff算法：patch过程。这个过程干了三件事： 创建节点 删除节点 更新节点
  */

  function invokeInsertHook (vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    if (isTrue(initial) && isDef(vnode.parent)) {
      vnode.parent.data.pendingInsert = queue
    } else {
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i])
      }
    }
  }

  let hydrationBailed = false
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap('attrs,class,staticClass,staticStyle,key')

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  function hydrate (elm, vnode, insertedVnodeQueue, inVPre) {
    let i
    const { tag, data, children } = vnode
    inVPre = inVPre || (data && data.pre)
    vnode.elm = elm

    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true
      return true
    }
    // assert node match
    if (process.env.NODE_ENV !== 'production') {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false
      }
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.init)) i(vnode, true /* hydrating */)
      if (isDef(i = vnode.componentInstance)) {
        // child component. it should have hydrated its own tree.
        initComponent(vnode, insertedVnodeQueue)
        return true
      }
    }
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue)
        } else {
          // v-html and domProps: innerHTML
          if (isDef(i = data) && isDef(i = i.domProps) && isDef(i = i.innerHTML)) {
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('server innerHTML: ', i)
                console.warn('client innerHTML: ', elm.innerHTML)
              }
              return false
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true
            let childNode = elm.firstChild
            for (let i = 0; i < children.length; i++) {
              if (!childNode || !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)) {
                childrenMatch = false
                break
              }
              childNode = childNode.nextSibling
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('Mismatching childNodes vs. VNodes: ', elm.childNodes, children)
              }
              return false
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false
        for (const key in data) {
          if (!isRenderedModule(key)) {
            fullInvoke = true
            invokeCreateHooks(vnode, insertedVnodeQueue)
            break
          }
        }
        if (!fullInvoke && data['class']) {
          // ensure collecting deps for deep class bindings for future updates
          traverse(data['class'])
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text
    }
    return true
  }

  function assertNodeMatch (node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return vnode.tag.indexOf('vue-component') === 0 || (
        !isUnknownElement(vnode, inVPre) &&
        vnode.tag.toLowerCase() === (node.tagName && node.tagName.toLowerCase())
      )
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3)
    }
  }

  return function patch (oldVnode, vnode, hydrating, removeOnly) {
    if (isUndef(vnode)) {
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode)
      return
    }

    let isInitialPatch = false
    const insertedVnodeQueue = []

    if (isUndef(oldVnode)) {
      // empty mount (likely as component), create new root element
      isInitialPatch = true
      createElm(vnode, insertedVnodeQueue)
    } else {
      const isRealElement = isDef(oldVnode.nodeType)
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // patch existing root node
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly)
      } else {
        if (isRealElement) {
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR)
            hydrating = true
          }
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              invokeInsertHook(vnode, insertedVnodeQueue, true)
              return oldVnode
            } else if (process.env.NODE_ENV !== 'production') {
              warn(
                'The client-side rendered virtual DOM tree is not matching ' +
                'server-rendered content. This is likely caused by incorrect ' +
                'HTML markup, for example nesting block-level elements inside ' +
                '<p>, or missing <tbody>. Bailing hydration and performing ' +
                'full client-side render.'
              )
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it
          oldVnode = emptyNodeAt(oldVnode)
        }

        // replacing existing element
        const oldElm = oldVnode.elm
        const parentElm = nodeOps.parentNode(oldElm)

        // create new node  创建新节点
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm)
        )

        // update parent placeholder node element, recursively 递归更新父占位符节点元素
        if (isDef(vnode.parent)) {
          let ancestor = vnode.parent
          const patchable = isPatchable(vnode)
          while (ancestor) {
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor)
            }
            ancestor.elm = vnode.elm
            if (patchable) {
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor)
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]()
                }
              }
            } else {
              registerRef(ancestor)
            }
            ancestor = ancestor.parent
          }
        }

        // destroy old node  销毁旧节点
        if (isDef(parentElm)) {
          removeVnodes([oldVnode], 0, 0)
        } else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode)
        }
      }
    }

    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)
    return vnode.elm
  }
}
