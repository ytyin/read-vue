/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// `createCompilerCreator` allows creating compilers that use alternative  createCompilerCreator允许创建使用可选解析器/优化器/codegen的编译器
// parser/optimizer/codegen, e.g the SSR optimizing compiler.   例如SSR优化编译器。
// Here we just export a default compiler using the default parts. 在这里，我们使用默认的部分到处一个默认的编译器
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  // 模板解析阶段：用正则等方式解析template模板中的指令、class、style等数据，形成AST
  const ast = parse(template.trim(), options) // parse会用正则等方式解析template模板中的指令、class、style等数据，形成AST
  if (options.optimize !== false) {
    // 优化阶段：遍历AST,找出其中的静态节点，并打上标记
    optimize(ast, options) // optimize的主要作用是标记静态节点，这是Vue在编译过程中的一处优化，挡在进行patch的过程中，DOM-Diff算法会直接跳过静态节点，从而减少了比较大过程，优化了patch的性能。
  }
  // 代码生成阶段: 将AST转换成渲染函数
  const code = generate(ast, options) // 将AST转化成render函数字符串的过程，得到结果是render函数的字符串以及staticRenderFns字符串
  return {
    ast,  // 抽象语法树（ast）
    render: code.render, // 渲染函数（render）
    staticRenderFns: code.staticRenderFns // 静态渲染函数（staticRenderFns）
  }
  // 最终返回了抽象语法树（ast）,渲染函数（render）,静态渲染函数（staticRenderFns）,且render的值为code.render,staticRenderFns的值为code.staticRenderFns,也就是说通过generate处理ast之后得到的返回值code是一个对象
  /**
   * 下面再给出模板编译内部具体流程图，便于理解。流程图如下：
   *               ---------------------------------------
   *              ｜                                      ｜
   *              ｜                                      ｜ 输出
   * 用户写的模板------> 解析器------> 优化器------> 代码生成器------> 渲染函数
   *              ｜                                      ｜
   *              ｜               模板编译                ｜
   *               ---------------------------------------
   *
   * 总结： 这片文章首先引出了为什么会有模板编译，因为有了模板编译，才有了虚拟DOM,才有了后续的视图更新。
   *   接着介绍了什么是模板编译，以及介绍了吧用户所写的模板经过层层处理知道最终渲染的视图中这个整体的渲染流程；
   *   最后介绍了模板编译过程中所需要使用的抽象语法树的概念以及分析了模板编译的具体实施流程，其流程大致分为三个阶段，
   *   分别是模板解析阶段、优化阶段和代码生成阶段。那么接下来的几篇文章会将这三个阶段逐一进行分析介绍。
  */
})

/**
 * VNode是从哪里来的呢？ 你可以这么理解：把用户写的模板进行编译，就会产生VNode
 * 什么是模板编译？ 在日常开发中，我们把写在<tenplate></tenplate>标签中的类似于原生HTML中的内容称之为模板。
 * 为什么是“类似于原生HTML中的内容”而不是“就是HTML的内容”？
 *  因为我们在开发中，在<template></template>标签中除了写一些原生HTML的标签，我们还会写一些变量插值，如，或者写一些Vue指令，如v-on、v-if等。
 * 而这些东西都是在原生HTML语法中不存在的，不被接受的。但是事实上我们确实这么写了，也被正确的识别了，页面也正常显示了，这又是为什么呢？
 *  这就归功于Vue的模板编译了，Vue会把用户在<template></template>标签中写的类似于原生HTML的内容找出来，再把非原生HTML找出来，经过一系列的逻辑处理生成渲染函数，
 *  也就是render函数，而render函数会将模板内容生成对应的VNode,而VNode再经过前几篇文章介绍的patch过程从而得到将要渲染的视图中的VNode,
 *  最后根据VNode创建真实的DOM节点并插入到视图中，最终完成视图的渲染更新。
 *  把用户在<template></template>标签中写的类似于原生HTML的内容进行编译，把原生HTML的内容找出来，再把非原生HTML找出来，经过一系列的逻辑处理生成渲染函数，
 *  也就是render函数的这一段过程称之为模板编译过程
 *
 * 整体渲染流程：
 * 所谓渲染流程，就是把用户写的类似于原生HML的模板经过一系列处理最终反应到视图中称之为整个渲染流程。流程图如下：
 *  用户写的模板 ---> 编译模板 ---> render函数 ---> VNode ---> patch ---> 视图
 *     /|\                         /|\           /|\                  /|\
 *      |                           |             |                    |
 *      |<---       模板编译     --->｜            ｜<---    虚拟DOM  --->|
 *
 *  从图中我们也可以看到，模板编译过程就是把用户写的模板经过一系列处理最终生成render函数的过程
 *
 *  那么模板编译内部是怎么把用户写的模板经过处理最终生成render函数的呢？内部的过程是怎样的呢？
 *  1.抽象语法树AST
 *    在<template></template>标签中写的模板对于Vue来说就是一堆字符串，如何从中提取出元素的标签、属性、变量插值的等有效信息呢？
 *  这就需要借助一个叫做抽象语法树的东西
 *    所谓抽象语法树，在计算机科学中，抽象语法树（Abstract Syntax Tree, AST），或简称语法树（Syntax Tree）,是源代码语法结构的一种抽象表示。
 *  它以数组昂的形式表现编程语言的语法结构，树上的每个节点都表示源代码中的一种结构。之所以说语法是“抽象”的，是因为这里的语法并不会表示出真实语法中出现的每个细节。
 *  比如，嵌套括号被隐含在树结构中，并没有以节点的形式呈现；而类似于if-condition-then这样的条件跳转语句，可以使用带有两个分支的节点来表示。---来自百度百科
 *  2.具体流程
 *    将一堆字符串模板解析成抽象语法树AST后，我们就可以对其进行各种操作处理了，处理完后用处理后的AST来生成render函数。具体流程可以大致分为三个阶段：
 *   1）模板解析阶段---解析器---源码路径： src/compiler/parser/index.js
 *   2) 优化阶段---优化器---源码路径：src/compiler/optimizer.js
 *   3) 代码生成阶段---代码生成器---源码路径：src/compiler/codegen/index.js
 */
