#!/usr/bin/env node

/**
 * Redis-like In-Memory Data Store
 * Phase 14: Streams
 * 
 * Entry point: node server.js
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

/**
 * Redis List implementation with efficient operations
 */
class RedisList {
    constructor() {
        this.elements = [];
    }

    /**
     * Push elements to the left (beginning) of the list
     * @param {...any} elements - Elements to push
     * @returns {number} - New length of the list
     */
    lpush(...elements) {
        // Elements should be added one by one from left to right
        // So if we LPUSH a b c, the result should be [c, b, a, ...existing]
        for (const element of elements) {
            this.elements.unshift(element);
        }
        return this.elements.length;
    }

    /**
     * Push elements to the right (end) of the list
     * @param {...any} elements - Elements to push
     * @returns {number} - New length of the list
     */
    rpush(...elements) {
        this.elements.push(...elements);
        return this.elements.length;
    }

    /**
     * Pop element from the left (beginning) of the list
     * @returns {any} - Popped element or undefined if empty
     */
    lpop() {
        return this.elements.shift();
    }

    /**
     * Pop element from the right (end) of the list
     * @returns {any} - Popped element or undefined if empty
     */
    rpop() {
        return this.elements.pop();
    }

    /**
     * Get the length of the list
     * @returns {number} - Length of the list
     */
    length() {
        return this.elements.length;
    }

    /**
     * Get element at specific index
     * @param {number} index - Index (can be negative for reverse indexing)
     * @returns {any} - Element at index or undefined
     */
    index(index) {
        const len = this.elements.length;
        if (len === 0) return undefined;

        // Handle negative indices
        if (index < 0) {
            index = len + index;
        }

        if (index < 0 || index >= len) {
            return undefined;
        }

        return this.elements[index];
    }

    /**
     * Set element at specific index
     * @param {number} index - Index to set
     * @param {any} value - Value to set
     * @returns {boolean} - True if successful, false if index out of range
     */
    set(index, value) {
        const len = this.elements.length;
        if (len === 0) return false;

        // Handle negative indices
        if (index < 0) {
            index = len + index;
        }

        if (index < 0 || index >= len) {
            return false;
        }

        this.elements[index] = value;
        return true;
    }

    /**
     * Get range of elements
     * @param {number} start - Start index (inclusive)
     * @param {number} stop - Stop index (inclusive)
     * @returns {Array} - Array of elements in range
     */
    range(start, stop) {
        const len = this.elements.length;
        if (len === 0) return [];

        // Handle negative indices
        if (start < 0) start = len + start;
        if (stop < 0) stop = len + stop;

        // Clamp to valid range
        start = Math.max(0, start);
        stop = Math.min(len - 1, stop);

        if (start > stop) return [];

        return this.elements.slice(start, stop + 1);
    }

    /**
     * Trim list to specified range
     * @param {number} start - Start index (inclusive)
     * @param {number} stop - Stop index (inclusive)
     */
    trim(start, stop) {
        const len = this.elements.length;
        if (len === 0) return;

        // Handle negative indices
        if (start < 0) start = len + start;
        if (stop < 0) stop = len + stop;

        // Clamp to valid range
        start = Math.max(0, start);
        stop = Math.min(len - 1, stop);

        if (start > stop) {
            this.elements = [];
        } else {
            this.elements = this.elements.slice(start, stop + 1);
        }
    }

    /**
     * Convert to array (for serialization)
     * @returns {Array} - Array representation
     */
    toArray() {
        return [...this.elements];
    }
}

/**
 * Redis Set implementation with uniqueness guarantee and set operations
 */
class RedisSet {
    constructor() {
        // Use Set for O(1) add/remove/has operations and automatic uniqueness
        this.members = new Set();
    }

    /**
     * Add members to the set
     * @param {...any} members - Members to add
     * @returns {number} - Number of new members added
     */
    sadd(...members) {
        let addedCount = 0;
        for (const member of members) {
            if (!this.members.has(member)) {
                this.members.add(member);
                addedCount++;
            }
        }
        return addedCount;
    }

    /**
     * Remove members from the set
     * @param {...any} members - Members to remove
     * @returns {number} - Number of members removed
     */
    srem(...members) {
        let removedCount = 0;
        for (const member of members) {
            if (this.members.has(member)) {
                this.members.delete(member);
                removedCount++;
            }
        }
        return removedCount;
    }

    /**
     * Get all members of the set
     * @returns {Array} - Array of all members
     */
    smembers() {
        return Array.from(this.members);
    }

    /**
     * Get the cardinality (size) of the set
     * @returns {number} - Number of members in the set
     */
    scard() {
        return this.members.size;
    }

    /**
     * Check if a member exists in the set
     * @param {any} member - Member to check
     * @returns {boolean} - True if member exists
     */
    sismember(member) {
        return this.members.has(member);
    }

    /**
     * Get union with other sets
     * @param {...RedisSet} otherSets - Other sets to union with
     * @returns {RedisSet} - New set containing union
     */
    sunion(...otherSets) {
        const unionSet = new RedisSet();
        
        // Add all members from this set
        for (const member of this.members) {
            unionSet.members.add(member);
        }
        
        // Add all members from other sets
        for (const otherSet of otherSets) {
            for (const member of otherSet.members) {
                unionSet.members.add(member);
            }
        }
        
        return unionSet;
    }

    /**
     * Get intersection with other sets
     * @param {...RedisSet} otherSets - Other sets to intersect with
     * @returns {RedisSet} - New set containing intersection
     */
    sinter(...otherSets) {
        const intersectionSet = new RedisSet();
        
        if (otherSets.length === 0) {
            // If no other sets, return copy of this set
            for (const member of this.members) {
                intersectionSet.members.add(member);
            }
            return intersectionSet;
        }
        
        // Find members that exist in all sets
        for (const member of this.members) {
            let existsInAll = true;
            for (const otherSet of otherSets) {
                if (!otherSet.members.has(member)) {
                    existsInAll = false;
                    break;
                }
            }
            if (existsInAll) {
                intersectionSet.members.add(member);
            }
        }
        
        return intersectionSet;
    }

    /**
     * Get difference with other sets (members in this set but not in others)
     * @param {...RedisSet} otherSets - Other sets to subtract
     * @returns {RedisSet} - New set containing difference
     */
    sdiff(...otherSets) {
        const diffSet = new RedisSet();
        
        // Add members from this set that don't exist in any other set
        for (const member of this.members) {
            let existsInOther = false;
            for (const otherSet of otherSets) {
                if (otherSet.members.has(member)) {
                    existsInOther = true;
                    break;
                }
            }
            if (!existsInOther) {
                diffSet.members.add(member);
            }
        }
        
        return diffSet;
    }

    /**
     * Check if set is empty
     * @returns {boolean} - True if set is empty
     */
    isEmpty() {
        return this.members.size === 0;
    }

    /**
     * Convert to array (for serialization)
     * @returns {Array} - Array representation
     */
    toArray() {
        return Array.from(this.members);
    }
}

/**
 * Redis Sorted Set implementation with score-based ordering
 */
class RedisSortedSet {
    constructor() {
        // Use Map for O(1) member->score lookups
        this.scores = new Map();
        // Array to maintain sorted order for efficient range operations
        this.sortedMembers = [];
    }

    /**
     * Add members with scores to sorted set
     * @param {...any} args - Alternating score-member pairs
     * @returns {number} - Number of new members added
     */
    zadd(...args) {
        if (args.length === 0 || args.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for ZADD");
        }

        let addedCount = 0;
        const updates = [];
        
        // Parse score-member pairs
        for (let i = 0; i < args.length; i += 2) {
            const score = parseFloat(args[i]);
            const member = args[i + 1];
            
            if (isNaN(score)) {
                throw new Error("ERR value is not a valid float");
            }
            
            const existingScore = this.scores.get(member);
            const isNewMember = existingScore === undefined;
            
            if (isNewMember) {
                addedCount++;
            }
            
            updates.push({ member, score, isNewMember, existingScore });
        }
        
        // Apply all updates
        for (const { member, score, isNewMember, existingScore } of updates) {
            if (!isNewMember && existingScore === score) {
                continue; // No change needed
            }
            
            // Remove from sorted array if it exists
            if (!isNewMember) {
                this._removeFromSortedArray(member, existingScore);
            }
            
            // Update score
            this.scores.set(member, score);
            
            // Insert in correct position in sorted array
            this._insertIntoSortedArray(member, score);
        }
        
        return addedCount;
    }

    /**
     * Remove members from sorted set
     * @param {...any} members - Members to remove
     * @returns {number} - Number of members removed
     */
    zrem(...members) {
        let removedCount = 0;
        
        for (const member of members) {
            const score = this.scores.get(member);
            if (score !== undefined) {
                this.scores.delete(member);
                this._removeFromSortedArray(member, score);
                removedCount++;
            }
        }
        
        return removedCount;
    }

    /**
     * Get score of member
     * @param {any} member - Member to get score for
     * @returns {number|undefined} - Score or undefined if member doesn't exist
     */
    zscore(member) {
        return this.scores.get(member);
    }

    /**
     * Get rank (0-based index) of member
     * @param {any} member - Member to get rank for
     * @returns {number|undefined} - Rank or undefined if member doesn't exist
     */
    zrank(member) {
        if (!this.scores.has(member)) {
            return undefined;
        }
        
        return this.sortedMembers.findIndex(item => item.member === member);
    }

    /**
     * Get reverse rank (0-based index from highest score) of member
     * @param {any} member - Member to get reverse rank for
     * @returns {number|undefined} - Reverse rank or undefined if member doesn't exist
     */
    zrevrank(member) {
        const rank = this.zrank(member);
        if (rank === undefined) {
            return undefined;
        }
        
        return this.sortedMembers.length - 1 - rank;
    }

    /**
     * Get range of members by rank
     * @param {number} start - Start rank (inclusive)
     * @param {number} stop - Stop rank (inclusive)
     * @param {boolean} withScores - Include scores in result
     * @param {boolean} reverse - Reverse order (highest to lowest score)
     * @returns {Array} - Array of members or member-score pairs
     */
    zrange(start, stop, withScores = false, reverse = false) {
        const len = this.sortedMembers.length;
        if (len === 0) return [];

        // Handle negative indices
        if (start < 0) start = len + start;
        if (stop < 0) stop = len + stop;

        // Clamp to valid range
        start = Math.max(0, start);
        stop = Math.min(len - 1, stop);

        if (start > stop) return [];

        let result = [];
        const members = reverse ? 
            this.sortedMembers.slice().reverse() : 
            this.sortedMembers;

        for (let i = start; i <= stop; i++) {
            const item = members[i];
            if (withScores) {
                result.push(item.member, item.score);
            } else {
                result.push(item.member);
            }
        }

        return result;
    }

    /**
     * Get range of members by score
     * @param {number} min - Minimum score (inclusive)
     * @param {number} max - Maximum score (inclusive)
     * @param {boolean} withScores - Include scores in result
     * @param {boolean} reverse - Reverse order (highest to lowest score)
     * @param {number} offset - Skip this many matching elements
     * @param {number} count - Return only this many elements
     * @returns {Array} - Array of members or member-score pairs
     */
    zrangebyscore(min, max, withScores = false, reverse = false, offset = 0, count = -1) {
        if (min > max) return [];

        let result = [];
        const members = reverse ? 
            this.sortedMembers.slice().reverse() : 
            this.sortedMembers;

        let matched = 0;
        let added = 0;

        for (const item of members) {
            const score = item.score;
            
            if (score >= min && score <= max) {
                if (matched >= offset) {
                    if (count === -1 || added < count) {
                        if (withScores) {
                            result.push(item.member, score);
                        } else {
                            result.push(item.member);
                        }
                        added++;
                    } else {
                        break;
                    }
                }
                matched++;
            }
        }

        return result;
    }

    /**
     * Count members in score range
     * @param {number} min - Minimum score (inclusive)
     * @param {number} max - Maximum score (inclusive)
     * @returns {number} - Count of members in range
     */
    zcount(min, max) {
        if (min > max) return 0;

        let count = 0;
        for (const item of this.sortedMembers) {
            if (item.score >= min && item.score <= max) {
                count++;
            }
        }
        return count;
    }

    /**
     * Get cardinality (number of members)
     * @returns {number} - Number of members in sorted set
     */
    zcard() {
        return this.sortedMembers.length;
    }

    /**
     * Increment score of member
     * @param {any} member - Member to increment
     * @param {number} increment - Amount to increment by
     * @returns {number} - New score after increment
     */
    zincrby(member, increment) {
        const currentScore = this.scores.get(member) || 0;
        const newScore = currentScore + increment;
        
        // Remove old entry if it exists
        if (this.scores.has(member)) {
            this._removeFromSortedArray(member, currentScore);
        }
        
        // Add with new score
        this.scores.set(member, newScore);
        this._insertIntoSortedArray(member, newScore);
        
        return newScore;
    }

    /**
     * Remove members by rank range
     * @param {number} start - Start rank (inclusive)
     * @param {number} stop - Stop rank (inclusive)
     * @returns {number} - Number of members removed
     */
    zremrangebyrank(start, stop) {
        const len = this.sortedMembers.length;
        if (len === 0) return 0;

        // Handle negative indices
        if (start < 0) start = len + start;
        if (stop < 0) stop = len + stop;

        // Clamp to valid range
        start = Math.max(0, start);
        stop = Math.min(len - 1, stop);

        if (start > stop) return 0;

        const toRemove = this.sortedMembers.slice(start, stop + 1);
        
        // Remove from scores map
        for (const item of toRemove) {
            this.scores.delete(item.member);
        }
        
        // Remove from sorted array
        this.sortedMembers.splice(start, stop - start + 1);
        
        return toRemove.length;
    }

    /**
     * Remove members by score range
     * @param {number} min - Minimum score (inclusive)
     * @param {number} max - Maximum score (inclusive)
     * @returns {number} - Number of members removed
     */
    zremrangebyscore(min, max) {
        if (min > max) return 0;

        const toRemove = [];
        
        // Find members to remove
        for (let i = 0; i < this.sortedMembers.length; i++) {
            const item = this.sortedMembers[i];
            if (item.score >= min && item.score <= max) {
                toRemove.push({ index: i, member: item.member });
            }
        }
        
        // Remove in reverse order to maintain indices
        for (let i = toRemove.length - 1; i >= 0; i--) {
            const { index, member } = toRemove[i];
            this.scores.delete(member);
            this.sortedMembers.splice(index, 1);
        }
        
        return toRemove.length;
    }

    /**
     * Check if sorted set is empty
     * @returns {boolean} - True if sorted set is empty
     */
    isEmpty() {
        return this.sortedMembers.length === 0;
    }

    /**
     * Insert member with score into sorted array maintaining order
     * @param {any} member - Member to insert
     * @param {number} score - Score of member
     * @private
     */
    _insertIntoSortedArray(member, score) {
        const item = { member, score };
        
        // Binary search for insertion point
        let left = 0;
        let right = this.sortedMembers.length;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            const midItem = this.sortedMembers[mid];
            
            // Compare by score first, then by member (lexicographically) for stable sorting
            if (midItem.score < score || 
                (midItem.score === score && midItem.member < member)) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        this.sortedMembers.splice(left, 0, item);
    }

    /**
     * Remove member from sorted array
     * @param {any} member - Member to remove
     * @param {number} score - Score of member
     * @private
     */
    _removeFromSortedArray(member, score) {
        const index = this.sortedMembers.findIndex(
            item => item.member === member && item.score === score
        );
        
        if (index !== -1) {
            this.sortedMembers.splice(index, 1);
        }
    }

    /**
     * Get range of members by lexicographical order (requires same scores)
     * @param {string} min - Minimum lexicographical bound
     * @param {string} max - Maximum lexicographical bound
     * @param {number} offset - Skip this many matching elements
     * @param {number} count - Return only this many elements
     * @param {boolean} reverse - Reverse order
     * @returns {Array} - Array of members in lexicographical range
     */
    zrangebylex(min, max, offset = 0, count = -1, reverse = false) {
        let result = [];
        const members = reverse ? 
            this.sortedMembers.slice().reverse() : 
            this.sortedMembers;

        let matched = 0;
        let added = 0;

        for (const item of members) {
            const member = item.member;
            
            // Check lexicographical bounds
            if (this._isInLexRange(member, min, max)) {
                if (matched >= offset) {
                    if (count === -1 || added < count) {
                        result.push(member);
                        added++;
                    } else {
                        break;
                    }
                }
                matched++;
            }
        }

        return result;
    }

    /**
     * Count members in lexicographical range
     * @param {string} min - Minimum lexicographical bound
     * @param {string} max - Maximum lexicographical bound
     * @returns {number} - Count of members in range
     */
    zlexcount(min, max) {
        let count = 0;
        for (const item of this.sortedMembers) {
            if (this._isInLexRange(item.member, min, max)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Remove members by lexicographical range
     * @param {string} min - Minimum lexicographical bound
     * @param {string} max - Maximum lexicographical bound
     * @returns {number} - Number of members removed
     */
    zremrangebylex(min, max) {
        const toRemove = [];
        
        // Find members to remove
        for (let i = 0; i < this.sortedMembers.length; i++) {
            const item = this.sortedMembers[i];
            if (this._isInLexRange(item.member, min, max)) {
                toRemove.push({ index: i, member: item.member });
            }
        }
        
        // Remove in reverse order to maintain indices
        for (let i = toRemove.length - 1; i >= 0; i--) {
            const { index, member } = toRemove[i];
            this.scores.delete(member);
            this.sortedMembers.splice(index, 1);
        }
        
        return toRemove.length;
    }

    /**
     * Check if member is within lexicographical range
     * @param {string} member - Member to check
     * @param {string} min - Minimum bound (with [ or ( prefix)
     * @param {string} max - Maximum bound (with [ or ( prefix)
     * @returns {boolean} - True if member is in range
     * @private
     */
    _isInLexRange(member, min, max) {
        // Parse bounds
        const minInclusive = min.startsWith('[');
        const maxInclusive = max.startsWith('[');
        const minValue = min.slice(1);
        const maxValue = max.slice(1);
        
        // Handle special cases
        if (minValue === '-') return this._checkMaxBound(member, max, maxInclusive, maxValue);
        if (maxValue === '+') return this._checkMinBound(member, min, minInclusive, minValue);
        if (minValue === '-' && maxValue === '+') return true;
        
        // Check bounds
        const minCheck = this._checkMinBound(member, min, minInclusive, minValue);
        const maxCheck = this._checkMaxBound(member, max, maxInclusive, maxValue);
        
        return minCheck && maxCheck;
    }

    /**
     * Check minimum bound for lexicographical range
     * @param {string} member - Member to check
     * @param {string} min - Original min bound string
     * @param {boolean} minInclusive - Whether bound is inclusive
     * @param {string} minValue - Min value without prefix
     * @returns {boolean} - True if member satisfies min bound
     * @private
     */
    _checkMinBound(member, min, minInclusive, minValue) {
        if (minValue === '-') return true;
        const cmp = member.localeCompare(minValue);
        return minInclusive ? cmp >= 0 : cmp > 0;
    }

    /**
     * Check maximum bound for lexicographical range
     * @param {string} member - Member to check
     * @param {string} max - Original max bound string
     * @param {boolean} maxInclusive - Whether bound is inclusive
     * @param {string} maxValue - Max value without prefix
     * @returns {boolean} - True if member satisfies max bound
     * @private
     */
    _checkMaxBound(member, max, maxInclusive, maxValue) {
        if (maxValue === '+') return true;
        const cmp = member.localeCompare(maxValue);
        return maxInclusive ? cmp <= 0 : cmp < 0;
    }

    /**
     * Pop minimum scored members
     * @param {number} count - Number of members to pop
     * @returns {Array} - Array of popped members with scores
     */
    zpopmin(count = 1) {
        const result = [];
        const actualCount = Math.min(count, this.sortedMembers.length);
        
        for (let i = 0; i < actualCount; i++) {
            const item = this.sortedMembers.shift();
            if (item) {
                this.scores.delete(item.member);
                result.push(item.member, item.score.toString());
            }
        }
        
        return result;
    }

    /**
     * Pop maximum scored members
     * @param {number} count - Number of members to pop
     * @returns {Array} - Array of popped members with scores
     */
    zpopmax(count = 1) {
        const result = [];
        const actualCount = Math.min(count, this.sortedMembers.length);
        
        for (let i = 0; i < actualCount; i++) {
            const item = this.sortedMembers.pop();
            if (item) {
                this.scores.delete(item.member);
                result.push(item.member, item.score.toString());
            }
        }
        
        return result;
    }

    /**
     * Get scores for multiple members
     * @param {...string} members - Members to get scores for
     * @returns {Array} - Array of scores (null for non-existent members)
     */
    zmscore(...members) {
        return members.map(member => {
            const score = this.scores.get(member);
            return score !== undefined ? score.toString() : null;
        });
    }

    /**
     * Get random member(s) from sorted set
     * @param {number} count - Number of members to return
     * @param {boolean} withScores - Whether to include scores
     * @returns {Array} - Array of random members (and optionally scores)
     */
    zrandmember(count = 1, withScores = false) {
        if (this.sortedMembers.length === 0) {
            return [];
        }

        const result = [];
        const isNegativeCount = count < 0;
        const actualCount = Math.abs(count);
        
        if (isNegativeCount) {
            // Allow duplicates
            for (let i = 0; i < actualCount; i++) {
                const randomIndex = Math.floor(Math.random() * this.sortedMembers.length);
                const item = this.sortedMembers[randomIndex];
                result.push(item.member);
                if (withScores) {
                    result.push(item.score.toString());
                }
            }
        } else {
            // No duplicates - shuffle and take first 'count' elements
            const indices = Array.from({ length: this.sortedMembers.length }, (_, i) => i);
            for (let i = indices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }
            
            const selectedIndices = indices.slice(0, Math.min(actualCount, indices.length));
            for (const index of selectedIndices) {
                const item = this.sortedMembers[index];
                result.push(item.member);
                if (withScores) {
                    result.push(item.score.toString());
                }
            }
        }
        
        return result;
    }

    /**
     * Incrementally iterate sorted set members (scan)
     * @param {number} cursor - Current cursor position
     * @param {string} pattern - Match pattern (default '*')
     * @param {number} count - Approximate number of elements to return
     * @returns {Array} - [nextCursor, results]
     */
    zscan(cursor, pattern = '*', count = 10) {
        const memberArray = this.sortedMembers.map(item => [item.member, item.score.toString()]).flat();
        const start = cursor;
        const end = Math.min(start + count, memberArray.length);
        
        // Simple pattern matching (only supports * for now)
        let filtered = memberArray.slice(start, end);
        if (pattern !== '*') {
            // Convert glob pattern to regex (simple version)
            const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
            const regex = new RegExp(`^${regexPattern}$`);
            
            filtered = [];
            for (let i = start; i < end; i += 2) {
                if (i + 1 < memberArray.length && regex.test(memberArray[i])) {
                    filtered.push(memberArray[i], memberArray[i + 1]);
                }
            }
        }
        
        const nextCursor = end >= memberArray.length ? 0 : end;
        return [nextCursor, filtered];
    }

    /**
     * Convert to array (for serialization)
     * @returns {Array} - Array representation
     */
    toArray() {
        return this.sortedMembers.map(item => ({ member: item.member, score: item.score }));
    }
}

/**
 * Redis Hash implementation with field-value operations
 */
class RedisHash {
    constructor() {
        // Use Map for O(1) field operations and proper key ordering
        this.fields = new Map();
        // Field-level expiration (Redis 7.2+ feature)
        this.fieldExpirations = new Map();
    }

    /**
     * Set field(s) in hash
     * @param {...any} args - Alternating field-value pairs
     * @returns {number} - Number of new fields added
     */
    hset(...args) {
        if (args.length === 0 || args.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for HSET");
        }

        let newFieldsCount = 0;
        for (let i = 0; i < args.length; i += 2) {
            const field = args[i];
            const value = args[i + 1];
            
            if (!this.fields.has(field)) {
                newFieldsCount++;
            }
            this.fields.set(field, value);
        }
        
        return newFieldsCount;
    }

    /**
     * Get field value from hash
     * @param {string} field - Field name
     * @returns {any} - Field value or undefined
     */
    hget(field) {
        return this.fields.get(field);
    }

    /**
     * Get multiple field values
     * @param {...string} fields - Field names
     * @returns {Array} - Array of values (undefined for non-existent fields)
     */
    hmget(...fields) {
        return fields.map(field => this.fields.get(field));
    }

    /**
     * Get all field-value pairs
     * @returns {Array} - Flat array of alternating field-value pairs
     */
    hgetall() {
        const result = [];
        for (const [field, value] of this.fields.entries()) {
            result.push(field, value);
        }
        return result;
    }

    /**
     * Delete field(s) from hash
     * @param {...string} fields - Field names to delete
     * @returns {number} - Number of fields deleted
     */
    hdel(...fields) {
        let deletedCount = 0;
        for (const field of fields) {
            if (this.fields.delete(field)) {
                deletedCount++;
            }
        }
        return deletedCount;
    }

    /**
     * Check if field exists in hash
     * @param {string} field - Field name
     * @returns {boolean} - True if field exists
     */
    hexists(field) {
        return this.fields.has(field);
    }

    /**
     * Get all field names
     * @returns {Array} - Array of field names
     */
    hkeys() {
        return Array.from(this.fields.keys());
    }

    /**
     * Get all values
     * @returns {Array} - Array of values
     */
    hvals() {
        return Array.from(this.fields.values());
    }

    /**
     * Get number of fields
     * @returns {number} - Number of fields in hash
     */
    hlen() {
        return this.fields.size;
    }

    /**
     * Increment field by integer value
     * @param {string} field - Field name
     * @param {number} increment - Integer increment
     * @returns {number} - New value after increment
     */
    hincrby(field, increment) {
        const currentValue = this.fields.get(field) || '0';
        const numValue = parseInt(currentValue, 10);
        
        if (isNaN(numValue)) {
            throw new Error("ERR hash value is not an integer");
        }
        
        const newValue = numValue + increment;
        this.fields.set(field, newValue.toString());
        return newValue;
    }

    /**
     * Increment field by float value
     * @param {string} field - Field name
     * @param {number} increment - Float increment
     * @returns {number} - New value after increment
     */
    hincrbyfloat(field, increment) {
        const currentValue = this.fields.get(field) || '0';
        const numValue = parseFloat(currentValue);
        
        if (isNaN(numValue)) {
            throw new Error("ERR hash value is not a float");
        }
        
        const newValue = numValue + increment;
        this.fields.set(field, newValue.toString());
        return newValue;
    }

    /**
     * Set field only if it doesn't exist
     * @param {string} field - Field name
     * @param {any} value - Value to set
     * @returns {boolean} - True if field was set, false if it already existed
     */
    hsetnx(field, value) {
        if (this.fields.has(field)) {
            return false;
        }
        this.fields.set(field, value);
        return true;
    }

    /**
     * Check if hash is empty
     * @returns {boolean} - True if hash is empty
     */
    isEmpty() {
        return this.fields.size === 0;
    }

    /**
     * Set multiple field-value pairs (legacy HMSET compatibility)
     * @param {...any} args - Alternating field-value pairs
     * @returns {string} - Always returns "OK" for HMSET compatibility
     */
    hmset(...args) {
        if (args.length === 0 || args.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for HMSET");
        }

        for (let i = 0; i < args.length; i += 2) {
            const field = args[i];
            const value = args[i + 1];
            this.fields.set(field, value);
        }
        
        return "OK";
    }

    /**
     * Get the length of a hash field value
     * @param {string} field - Field name
     * @returns {number} - Length of field value, 0 if field doesn't exist
     */
    hstrlen(field) {
        const value = this.fields.get(field);
        return value === undefined ? 0 : value.toString().length;
    }

    /**
     * Get random field(s) from hash
     * @param {number} count - Number of fields to return (default 1)
     * @param {boolean} withValues - Whether to return values too
     * @returns {Array} - Array of random fields or field-value pairs
     */
    hrandfield(count = 1, withValues = false) {
        const fieldArray = Array.from(this.fields.keys());
        
        if (fieldArray.length === 0) {
            return [];
        }

        const result = [];
        const isNegativeCount = count < 0;
        const actualCount = Math.abs(count);
        
        if (isNegativeCount) {
            // Allow duplicates
            for (let i = 0; i < actualCount; i++) {
                const randomField = fieldArray[Math.floor(Math.random() * fieldArray.length)];
                if (withValues) {
                    result.push(randomField, this.fields.get(randomField));
                } else {
                    result.push(randomField);
                }
            }
        } else {
            // No duplicates - shuffle and take first 'count' elements
            const shuffled = [...fieldArray];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            
            const selected = shuffled.slice(0, Math.min(actualCount, shuffled.length));
            for (const field of selected) {
                if (withValues) {
                    result.push(field, this.fields.get(field));
                } else {
                    result.push(field);
                }
            }
        }
        
        return result;
    }

    /**
     * Scan hash fields with cursor-based iteration
     * @param {number} cursor - Cursor position
     * @param {string} pattern - Pattern to match (supports * and ?)
     * @param {number} count - Hint for number of elements to return
     * @returns {Array} - [nextCursor, [field1, value1, field2, value2, ...]]
     */
    hscan(cursor, pattern = '*', count = 10) {
        const entries = Array.from(this.fields.entries());
        
        // Convert pattern to regex
        let regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`);
        
        // Filter entries by pattern
        const filteredEntries = entries.filter(([field, value]) => regex.test(field));
        
        // Calculate slice bounds
        const start = cursor;
        const end = Math.min(start + count, filteredEntries.length);
        const slice = filteredEntries.slice(start, end);
        
        // Determine next cursor
        const nextCursor = end >= filteredEntries.length ? 0 : end;
        
        // Flatten field-value pairs
        const result = [];
        for (const [field, value] of slice) {
            result.push(field, value);
        }
        
        return [nextCursor, result];
    }

    /**
     * Check if field has expired and clean it up
     * @param {string} field - Field to check
     * @returns {boolean} - True if field has expired
     */
    isFieldExpired(field) {
        if (!this.fieldExpirations.has(field)) {
            return false;
        }

        const expireTime = this.fieldExpirations.get(field);
        const now = Date.now();
        
        if (now >= expireTime) {
            // Field has expired, clean it up
            this.fields.delete(field);
            this.fieldExpirations.delete(field);
            return true;
        }
        
        return false;
    }

    /**
     * Get field value checking for expiration
     * @param {string} field - Field to get
     * @returns {any} - Value or undefined if expired/missing
     */
    getField(field) {
        if (this.isFieldExpired(field)) {
            return undefined;
        }
        return this.fields.get(field);
    }

    /**
     * Set field expiration
     * @param {string} field - Field name
     * @param {number} expireTimeMs - Expiration time in milliseconds
     * @returns {boolean} - True if field exists and expiration was set
     */
    setFieldExpiration(field, expireTimeMs) {
        if (!this.fields.has(field) || this.isFieldExpired(field)) {
            return false;
        }
        this.fieldExpirations.set(field, expireTimeMs);
        return true;
    }

    /**
     * Get field TTL in milliseconds
     * @param {string} field - Field name
     * @returns {number} - TTL in ms, -1 if no expiration, -2 if field doesn't exist
     */
    getFieldTTL(field) {
        if (!this.fields.has(field) || this.isFieldExpired(field)) {
            return -2; // Field doesn't exist
        }
        
        if (!this.fieldExpirations.has(field)) {
            return -1; // No expiration
        }
        
        const expireTime = this.fieldExpirations.get(field);
        const now = Date.now();
        const ttl = expireTime - now;
        
        return ttl > 0 ? ttl : -2;
    }

    /**
     * Remove field expiration
     * @param {string} field - Field name
     * @returns {boolean} - True if field exists and had expiration
     */
    persistField(field) {
        if (!this.fields.has(field) || this.isFieldExpired(field)) {
            return false;
        }
        
        return this.fieldExpirations.delete(field);
    }

    /**
     * Convert to object (for serialization)
     * @returns {Object} - Object representation
     */
    toObject() {
        const obj = {};
        for (const [field, value] of this.fields.entries()) {
            obj[field] = value;
        }
        return obj;
    }
}

/**
 * Redis JSON implementation for native JSON operations with JSONPath support
 * Provides complete 1:1 Redis JSON compatibility
 */
class RedisJSON {
    constructor() {
        this.data = null; // JSON data
        this.paths = new Map(); // Cache for path lookups
    }

    /**
     * Set JSON data at path
     * @param {string} path - JSONPath ($ for root)
     * @param {*} value - Value to set
     * @param {string} option - NX (only if not exists), XX (only if exists)
     * @returns {boolean} - Success status
     */
    set(path = '$', value, option = null) {
        if (path === '$' || path === '.') {
            // Root path - validate JSON
            try {
                if (typeof value === 'string') {
                    this.data = JSON.parse(value);
                } else {
                    this.data = value;
                }
                this.paths.clear(); // Clear cache
                return true;
            } catch (error) {
                throw new Error("ERR invalid JSON");
            }
        }

        if (this.data === null) {
            throw new Error("ERR no such key");
        }

        // Parse JSONPath and set value
        const pathResult = this._evaluatePath(path);
        if (!pathResult.exists && option === 'XX') {
            return false; // XX requires existing path
        }
        if (pathResult.exists && option === 'NX') {
            return false; // NX requires non-existing path
        }

        this._setAtPath(path, value);
        return true;
    }

    /**
     * Get JSON data at path
     * @param {string|Array} paths - JSONPath or array of paths
     * @param {string} indent - JSON formatting indent
     * @param {string} newline - JSON formatting newline
     * @param {string} space - JSON formatting space
     * @returns {string|Array} - JSON string or array of results
     */
    get(paths = '$', indent = null, newline = null, space = null) {
        if (this.data === null) {
            return null;
        }

        const isMultiplePaths = Array.isArray(paths);
        const pathArray = isMultiplePaths ? paths : [paths];
        const results = [];

        for (const path of pathArray) {
            const result = this._getAtPath(path);
            if (result === undefined) {
                results.push(null);
            } else {
                // Redis JSON always wraps results in arrays for JSONPath queries
                // For array results, wrap the contents, for objects/primitives wrap the value
                const arrayResult = Array.isArray(result) ? [result] : [result];
                
                // Format JSON response
                let jsonStr;
                if (indent || newline || space) {
                    jsonStr = JSON.stringify(arrayResult, null, indent || (space ? ' ' : null));
                    if (newline) jsonStr = jsonStr.replace(/\n/g, newline);
                    if (space && !indent) jsonStr = jsonStr.replace(/:/g, ':' + space);
                    // Don't escape quotes for formatted output
                } else {
                    jsonStr = JSON.stringify(arrayResult);
                    // Escape inner quotes for Redis response format
                    jsonStr = jsonStr.replace(/"/g, '\\"');
                }
                results.push(jsonStr);
            }
        }

        return isMultiplePaths ? results : results[0];
    }

    /**
     * Delete JSON data at path
     * @param {string} path - JSONPath
     * @returns {number} - Number of deleted paths
     */
    del(path = '$') {
        if (this.data === null) {
            return 0;
        }

        if (path === '$' || path === '.') {
            this.data = null;
            this.paths.clear();
            return 1;
        }

        return this._deleteAtPath(path);
    }

    /**
     * Get type of JSON data at path
     * @param {string} path - JSONPath
     * @returns {string|Array} - JSON type(s)
     */
    type(path = '$') {
        if (this.data === null) {
            return null;
        }

        const result = this._getAtPath(path);
        if (result === undefined) {
            return null;
        }

        return this._getJSONType(result);
    }

    /**
     * Get string length at path
     * @param {string} path - JSONPath
     * @returns {number|Array} - String length(s)
     */
    strlen(path = '$') {
        const result = this._getAtPath(path);
        if (result === undefined || typeof result !== 'string') {
            return null;
        }
        return result.length;
    }

    /**
     * Append to array at path
     * @param {string} path - JSONPath to array
     * @param {...*} values - Values to append
     * @returns {number} - New array length
     */
    arrappend(path, ...values) {
        const arr = this._getAtPath(path);
        if (!Array.isArray(arr)) {
            throw new Error("ERR path is not an array");
        }

        arr.push(...values);
        return arr.length;
    }

    /**
     * Get array length at path
     * @param {string} path - JSONPath to array
     * @returns {number} - Array length
     */
    arrlen(path = '$') {
        const result = this._getAtPath(path);
        if (!Array.isArray(result)) {
            return null;
        }
        return result.length;
    }

    /**
     * Find index of value in array
     * @param {string} path - JSONPath to array
     * @param {*} searchValue - Value to search for
     * @param {number} start - Start index
     * @param {number} stop - Stop index
     * @returns {number} - Index of value or -1 if not found
     */
    arrindex(path, searchValue, start = 0, stop = -1) {
        const arr = this._getAtPath(path);
        if (!Array.isArray(arr)) {
            throw new Error("ERR path is not an array");
        }

        const actualStop = stop === -1 ? arr.length : stop;
        for (let i = start; i < actualStop && i < arr.length; i++) {
            if (JSON.stringify(arr[i]) === JSON.stringify(searchValue)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Insert values into array at index
     * @param {string} path - JSONPath to array
     * @param {number} index - Index to insert at
     * @param {...*} values - Values to insert
     * @returns {number} - New array length
     */
    arrinsert(path, index, ...values) {
        const arr = this._getAtPath(path);
        if (!Array.isArray(arr)) {
            throw new Error("ERR path is not an array");
        }

        if (index < 0 || index > arr.length) {
            throw new Error("ERR index out of range");
        }

        arr.splice(index, 0, ...values);
        return arr.length;
    }

    /**
     * Pop value from array
     * @param {string} path - JSONPath to array
     * @param {number} index - Index to pop (default: -1 for last)
     * @returns {*} - Popped value
     */
    arrpop(path, index = -1) {
        const arr = this._getAtPath(path);
        if (!Array.isArray(arr)) {
            throw new Error("ERR path is not an array");
        }

        if (arr.length === 0) {
            return null;
        }

        if (index === -1) {
            return arr.pop();
        }

        if (index < 0 || index >= arr.length) {
            throw new Error("ERR index out of range");
        }

        return arr.splice(index, 1)[0];
    }

    /**
     * Trim array to range
     * @param {string} path - JSONPath to array
     * @param {number} start - Start index
     * @param {number} stop - Stop index
     * @returns {number} - New array length
     */
    arrtrim(path, start, stop) {
        const arr = this._getAtPath(path);
        if (!Array.isArray(arr)) {
            throw new Error("ERR path is not an array");
        }

        const actualStart = Math.max(0, start);
        const actualStop = Math.min(arr.length - 1, stop);
        
        if (actualStart > actualStop || actualStart >= arr.length) {
            arr.length = 0;
            return 0;
        }

        const newArray = arr.slice(actualStart, actualStop + 1);
        arr.length = 0;
        arr.push(...newArray);
        return arr.length;
    }

    /**
     * Get object keys at path
     * @param {string} path - JSONPath to object
     * @returns {Array} - Object keys
     */
    objkeys(path = '$') {
        const result = this._getAtPath(path);
        if (result === null || typeof result !== 'object' || Array.isArray(result)) {
            return null;
        }
        return Object.keys(result);
    }

    /**
     * Get object length at path
     * @param {string} path - JSONPath to object
     * @returns {number} - Object length
     */
    objlen(path = '$') {
        const result = this._getAtPath(path);
        if (result === null || typeof result !== 'object' || Array.isArray(result)) {
            return null;
        }
        return Object.keys(result).length;
    }

    /**
     * Increment number at path
     * @param {string} path - JSONPath to number
     * @param {number} value - Increment value
     * @returns {number} - New value
     */
    numincrby(path, value) {
        const current = this._getAtPath(path);
        if (typeof current !== 'number') {
            throw new Error("ERR path is not a number");
        }

        const newValue = current + value;
        this._setAtPath(path, newValue);
        return newValue;
    }

    /**
     * Multiply number at path
     * @param {string} path - JSONPath to number
     * @param {number} value - Multiplier value
     * @returns {number} - New value
     */
    nummultby(path, value) {
        const current = this._getAtPath(path);
        if (typeof current !== 'number') {
            throw new Error("ERR path is not a number");
        }

        const newValue = current * value;
        this._setAtPath(path, newValue);
        return newValue;
    }

    /**
     * Append to string at path
     * @param {string} path - JSONPath to string
     * @param {string} value - String value to append
     * @returns {number} - New string length
     */
    strappend(path, value) {
        const current = this._getAtPath(path);
        if (typeof current !== 'string') {
            throw new Error("ERR path is not a string");
        }

        // Parse the value as JSON to get the actual string content
        let appendValue;
        try {
            appendValue = JSON.parse(value);
        } catch {
            // If not valid JSON, use as literal string
            appendValue = value;
        }

        const newValue = current + appendValue;
        this._setAtPath(path, newValue);
        return newValue.length;
    }

    /**
     * Toggle boolean value at path
     * @param {string} path - JSONPath to boolean
     * @returns {number} - New boolean value (0 or 1)
     */
    toggle(path) {
        const current = this._getAtPath(path);
        if (typeof current !== 'boolean') {
            throw new Error("ERR path is not a boolean");
        }

        const newValue = !current;
        this._setAtPath(path, newValue);
        return newValue ? 1 : 0;
    }

    /**
     * Merge JSON value into existing paths
     * @param {string} path - JSONPath to merge into
     * @param {*} value - Value to merge
     * @returns {string} - OK on success
     */
    merge(path, value) {
        const existing = this._getAtPath(path);
        if (existing === undefined) {
            throw new Error("ERR path does not exist");
        }

        // Parse the merge value if it's a string
        let mergeValue = value;
        if (typeof value === 'string') {
            try {
                mergeValue = JSON.parse(value);
            } catch {
                throw new Error("ERR invalid JSON for merge");
            }
        }

        // Perform merge based on types
        if (typeof existing === 'object' && existing !== null && !Array.isArray(existing) &&
            typeof mergeValue === 'object' && mergeValue !== null && !Array.isArray(mergeValue)) {
            // Merge objects
            const merged = { ...existing, ...mergeValue };
            this._setAtPath(path, merged);
        } else {
            // For non-object types, replace
            this._setAtPath(path, mergeValue);
        }
        
        return 'OK';
    }

    /**
     * Clear JSON value at path (set to appropriate empty value)
     * @param {string} path - JSONPath
     * @returns {number} - Number of cleared paths
     */
    clear(path = '$') {
        if (this.data === null) {
            return 0;
        }

        try {
            const currentType = this.type(path);
            let clearValue;

            switch (currentType) {
                case 'array':
                    clearValue = [];
                    break;
                case 'object':
                    clearValue = {};
                    break;
                case 'string':
                    clearValue = '';
                    break;
                case 'number':
                    clearValue = 0;
                    break;
                case 'boolean':
                    clearValue = false;
                    break;
                default:
                    clearValue = null;
            }

            this._setAtPath(path, clearValue);
            return 1;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check if data is empty
     * @returns {boolean}
     */
    isEmpty() {
        return this.data === null;
    }

    /**
     * Get data size in bytes (approximation)
     * @returns {number}
     */
    size() {
        if (this.data === null) return 0;
        return JSON.stringify(this.data).length;
    }

    /**
     * Evaluate JSONPath and get value
     * @param {string} path - JSONPath
     * @returns {*} - Value at path
     * @private
     */
    _getAtPath(path = '$') {
        if (path === '$' || path === '.') {
            return this.data;
        }

        // Enhanced JSONPath implementation to handle Redis-style paths
        try {
            // Remove $ prefix
            let evalPath = path.replace(/^\$/, '');
            if (!evalPath) return this.data;
            
            // Handle root array access: $[1] -> [1]
            if (evalPath.startsWith('[')) {
                const match = evalPath.match(/^\[(-?\d+)\](.*)$/);
                if (match) {
                    const index = parseInt(match[1], 10);
                    const remainingPath = match[2];
                    
                    if (!Array.isArray(this.data)) {
                        return undefined;
                    }
                    
                    // Handle negative indexing
                    const actualIndex = index < 0 ? this.data.length + index : index;
                    if (actualIndex < 0 || actualIndex >= this.data.length) {
                        return undefined;
                    }
                    
                    const current = this.data[actualIndex];
                    if (!remainingPath) {
                        return current;
                    }
                    
                    // Continue with remaining path
                    const tempJSON = new RedisJSON();
                    tempJSON.data = current;
                    return tempJSON._getAtPath('$' + remainingPath);
                }
            }
            
            // Handle dot notation: .field.subfield
            if (evalPath.startsWith('.')) {
                evalPath = evalPath.substring(1);
            }
            
            // Parse path into parts, handling array access and object notation
            const parts = [];
            let currentPart = '';
            let inBrackets = false;
            
            for (let i = 0; i < evalPath.length; i++) {
                const char = evalPath[i];
                
                if (char === '[') {
                    if (currentPart) {
                        parts.push(currentPart);
                        currentPart = '';
                    }
                    inBrackets = true;
                } else if (char === ']') {
                    if (inBrackets && currentPart) {
                        parts.push(parseInt(currentPart, 10));
                        currentPart = '';
                    }
                    inBrackets = false;
                } else if (char === '.' && !inBrackets) {
                    if (currentPart) {
                        parts.push(currentPart);
                        currentPart = '';
                    }
                } else {
                    currentPart += char;
                }
            }
            
            if (currentPart) {
                parts.push(inBrackets ? parseInt(currentPart, 10) : currentPart);
            }
            
            // Navigate through the parts
            let current = this.data;
            
            for (const part of parts) {
                if (current === null || current === undefined) {
                    return undefined;
                }
                
                if (typeof part === 'number') {
                    // Array indexing with negative index support
                    if (!Array.isArray(current)) {
                        return undefined;
                    }
                    const actualIndex = part < 0 ? current.length + part : part;
                    if (actualIndex < 0 || actualIndex >= current.length) {
                        return undefined;
                    }
                    current = current[actualIndex];
                } else {
                    // Object property access
                    current = current[part];
                }
            }
            
            return current;
        } catch (error) {
            return undefined;
        }
    }

    /**
     * Set value at JSONPath
     * @param {string} path - JSONPath
     * @param {*} value - Value to set
     * @private
     */
    _setAtPath(path, value) {
        if (path === '$' || path === '.') {
            this.data = value;
            return;
        }

        let evalPath = path.replace(/^\$\.?/, '');
        evalPath = evalPath.replace(/\[(\d+)\]/g, '.$1');
        
        const parts = evalPath.split('.');
        let current = this.data;
        
        // Navigate to parent
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] === undefined) {
                // Create intermediate objects/arrays as needed
                const nextPart = parts[i + 1];
                current[part] = /^\d+$/.test(nextPart) ? [] : {};
            }
            current = current[part];
        }
        
        // Set final value
        const lastPart = parts[parts.length - 1];
        current[lastPart] = value;
    }

    /**
     * Delete value at JSONPath
     * @param {string} path - JSONPath
     * @returns {number} - Number of deleted items
     * @private
     */
    _deleteAtPath(path) {
        // Handle root array access: $[-1] -> delete last element
        if (path.match(/^\$\[(-?\d+)\]$/)) {
            const match = path.match(/^\$\[(-?\d+)\]$/);
            if (match && Array.isArray(this.data)) {
                const index = parseInt(match[1], 10);
                const actualIndex = index < 0 ? this.data.length + index : index;
                if (actualIndex >= 0 && actualIndex < this.data.length) {
                    this.data.splice(actualIndex, 1);
                    return 1;
                }
            }
            return 0;
        }
        
        // Parse path using the enhanced parser
        try {
            // Remove $ prefix
            let evalPath = path.replace(/^\$/, '');
            if (!evalPath) return 0;
            
            // Handle dot notation
            if (evalPath.startsWith('.')) {
                evalPath = evalPath.substring(1);
            }
            
            // Parse path into parts
            const parts = [];
            let currentPart = '';
            let inBrackets = false;
            
            for (let i = 0; i < evalPath.length; i++) {
                const char = evalPath[i];
                
                if (char === '[') {
                    if (currentPart) {
                        parts.push(currentPart);
                        currentPart = '';
                    }
                    inBrackets = true;
                } else if (char === ']') {
                    if (inBrackets && currentPart) {
                        parts.push(parseInt(currentPart, 10));
                        currentPart = '';
                    }
                    inBrackets = false;
                } else if (char === '.' && !inBrackets) {
                    if (currentPart) {
                        parts.push(currentPart);
                        currentPart = '';
                    }
                } else {
                    currentPart += char;
                }
            }
            
            if (currentPart) {
                parts.push(inBrackets ? parseInt(currentPart, 10) : currentPart);
            }
            
            if (parts.length === 0) return 0;
            
            // Navigate to parent
            let current = this.data;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (current === null || current === undefined) {
                    return 0;
                }
                
                if (typeof part === 'number') {
                    if (!Array.isArray(current)) {
                        return 0;
                    }
                    const actualIndex = part < 0 ? current.length + part : part;
                    if (actualIndex < 0 || actualIndex >= current.length) {
                        return 0;
                    }
                    current = current[actualIndex];
                } else {
                    current = current[part];
                }
            }
            
            // Delete the last part
            const lastPart = parts[parts.length - 1];
            if (current === null || current === undefined) {
                return 0;
            }
            
            if (typeof lastPart === 'number') {
                if (!Array.isArray(current)) {
                    return 0;
                }
                const actualIndex = lastPart < 0 ? current.length + lastPart : lastPart;
                if (actualIndex >= 0 && actualIndex < current.length) {
                    current.splice(actualIndex, 1);
                    return 1;
                }
            } else {
                if (current[lastPart] !== undefined) {
                    delete current[lastPart];
                    return 1;
                }
            }
            
            return 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Evaluate path existence
     * @param {string} path - JSONPath
     * @returns {Object} - Path evaluation result
     * @private
     */
    _evaluatePath(path) {
        const value = this._getAtPath(path);
        return {
            exists: value !== undefined,
            value: value
        };
    }

    /**
     * Get JSON type of value
     * @param {*} value - Value to check
     * @returns {string} - JSON type
     * @private
     */
    _getJSONType(value) {
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'object') return 'object';
        if (typeof value === 'string') return 'string';
        if (typeof value === 'number') return 'number';
        if (typeof value === 'boolean') return 'boolean';
        return 'unknown';
    }

    /**
     * Convert to object for debugging
     * @returns {Object}
     */
    toObject() {
        return {
            data: this.data,
            size: this.size(),
            isEmpty: this.isEmpty()
        };
    }
}

/**
 * RedisGeo - Geospatial data structure
 * Uses sorted sets with geohash scoring for efficient geographic queries
 */
class RedisGeo {
    constructor() {
        // Use RedisSortedSet to store geospatial data
        // Score = geohash of coordinates, Member = location name
        this.sortedSet = new RedisSortedSet();
        
        // Store actual coordinates separately for precision
        this.coordinates = new Map(); // member -> {longitude, latitude}
    }

    /**
     * Add geospatial items to the set
     * @param {Array} items - Array of [longitude, latitude, member] triplets
     * @returns {number} Number of elements added
     */
    geoadd(...items) {
        if (items.length % 3 !== 0) {
            throw new Error("ERR wrong number of arguments for GEOADD");
        }

        let added = 0;
        for (let i = 0; i < items.length; i += 3) {
            const longitude = parseFloat(items[i]);
            const latitude = parseFloat(items[i + 1]);
            const member = items[i + 2];

            // Validate coordinates
            if (isNaN(longitude) || isNaN(latitude)) {
                throw new Error("ERR value is not a valid float");
            }
            
            if (!this.isValidCoordinate(longitude, latitude)) {
                throw new Error("ERR invalid longitude,latitude pair");
            }

            // Calculate geohash score
            const geohash = this.encodeGeohash(longitude, latitude);
            
            // Check if member already exists
            const existed = this.coordinates.has(member);
            
            // Store coordinates and add to sorted set
            this.coordinates.set(member, { longitude, latitude });
            this.sortedSet.zadd(geohash, member);
            
            if (!existed) {
                added++;
            }
        }

        return added;
    }

    /**
     * Get distance between two members
     * @param {string} member1 
     * @param {string} member2 
     * @param {string} unit - m, km, mi, ft
     * @returns {number} Distance in specified unit
     */
    geodist(member1, member2, unit = 'm') {
        const coord1 = this.coordinates.get(member1);
        const coord2 = this.coordinates.get(member2);

        if (!coord1 || !coord2) {
            return null;
        }

        const distance = this.haversineDistance(
            coord1.longitude, coord1.latitude,
            coord2.longitude, coord2.latitude
        );

        return this.convertDistance(distance, unit);
    }

    /**
     * Get positions (longitude, latitude) of members
     * @param {...string} members 
     * @returns {Array} Array of [longitude, latitude] pairs or null
     */
    geopos(...members) {
        return members.map(member => {
            const coord = this.coordinates.get(member);
            return coord ? [coord.longitude.toString(), coord.latitude.toString()] : null;
        });
    }

    /**
     * Get geohash strings for members
     * @param {...string} members 
     * @returns {Array} Array of geohash strings
     */
    geohash(...members) {
        return members.map(member => {
            const coord = this.coordinates.get(member);
            if (!coord) return null;
            
            return this.geohashString(coord.longitude, coord.latitude);
        });
    }

    /**
     * Search for members within radius from coordinates
     * @param {number} longitude 
     * @param {number} latitude 
     * @param {number} radius 
     * @param {string} unit 
     * @param {Object} options 
     * @returns {Array} Array of matching members with optional extra data
     */
    georadius(longitude, latitude, radius, unit, options = {}) {
        if (!this.isValidCoordinate(longitude, latitude)) {
            throw new Error("ERR invalid longitude,latitude pair");
        }

        const radiusInMeters = this.convertToMeters(radius, unit);
        const results = [];

        // Get all members and calculate distances
        for (const [member, coord] of this.coordinates.entries()) {
            const distance = this.haversineDistance(
                longitude, latitude,
                coord.longitude, coord.latitude
            );

            if (distance <= radiusInMeters) {
                const result = { member, distance };
                
                if (options.WITHCOORD) {
                    result.coordinates = [coord.longitude, coord.latitude];
                }
                if (options.WITHDIST) {
                    result.distanceFormatted = this.convertDistance(distance, unit);
                }
                if (options.WITHHASH) {
                    result.geohash = this.encodeGeohash(coord.longitude, coord.latitude);
                }

                results.push(result);
            }
        }

        // Sort results
        if (options.ASC) {
            results.sort((a, b) => a.distance - b.distance);
        } else if (options.DESC) {
            results.sort((a, b) => b.distance - a.distance);
        }

        // Apply count limit
        if (options.COUNT) {
            results.splice(options.COUNT);
        }

        return results;
    }

    /**
     * Search for members within radius from another member
     * @param {string} member 
     * @param {number} radius 
     * @param {string} unit 
     * @param {Object} options 
     * @returns {Array} Array of matching members
     */
    georadiusbymember(member, radius, unit, options = {}) {
        const coord = this.coordinates.get(member);
        if (!coord) {
            throw new Error("ERR could not decode requested zset member");
        }

        return this.georadius(coord.longitude, coord.latitude, radius, unit, options);
    }

    /**
     * Modern geosearch command (Redis 6.2+)
     * @param {string} fromMember - Search from this member
     * @param {number} longitude - Or search from these coordinates
     * @param {number} latitude 
     * @param {Object} shape - {radius, unit} or {width, height, unit}
     * @param {Object} options 
     * @returns {Array} Search results
     */
    geosearch(fromMember, longitude, latitude, shape, options = {}) {
        let searchLon, searchLat;

        if (fromMember) {
            const coord = this.coordinates.get(fromMember);
            if (!coord) {
                throw new Error("ERR could not decode requested zset member");
            }
            searchLon = coord.longitude;
            searchLat = coord.latitude;
        } else {
            searchLon = longitude;
            searchLat = latitude;
        }

        if (shape.radius) {
            // Radius search
            return this.georadius(searchLon, searchLat, shape.radius, shape.unit, options);
        } else {
            // Box search (simplified - treat as radius for now)
            const radius = Math.max(shape.width, shape.height) / 2;
            return this.georadius(searchLon, searchLat, radius, shape.unit, options);
        }
    }

    /**
     * Get all members (for general operations)
     */
    getMembers() {
        return Array.from(this.coordinates.keys());
    }

    /**
     * Remove members
     */
    zrem(...members) {
        let removed = 0;
        for (const member of members) {
            if (this.coordinates.has(member)) {
                this.coordinates.delete(member);
                this.sortedSet.zrem(member);
                removed++;
            }
        }
        return removed;
    }

    /**
     * Get member count
     */
    zcard() {
        return this.coordinates.size;
    }

    /**
     * Check if empty
     */
    isEmpty() {
        return this.coordinates.size === 0;
    }

    // ========== Geospatial Mathematics ==========

    /**
     * Validate geographic coordinates
     */
    isValidCoordinate(longitude, latitude) {
        return longitude >= -180 && longitude <= 180 && 
               latitude >= -85.05112878 && latitude <= 85.05112878;
    }

    /**
     * Calculate Haversine distance between two points
     * @param {number} lon1 
     * @param {number} lat1 
     * @param {number} lon2 
     * @param {number} lat2 
     * @returns {number} Distance in meters
     */
    haversineDistance(lon1, lat1, lon2, lat2) {
        const R = 6371000; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    /**
     * Convert distance to different units
     */
    convertDistance(meters, unit) {
        switch (unit) {
            case 'm': return parseFloat(meters.toFixed(4));
            case 'km': return parseFloat((meters / 1000).toFixed(4));
            case 'mi': return parseFloat((meters / 1609.344).toFixed(4));
            case 'ft': return parseFloat((meters * 3.28084).toFixed(4));
            default: throw new Error("ERR unsupported unit provided. please use m, km, ft, mi");
        }
    }

    /**
     * Convert distance to meters
     */
    convertToMeters(distance, unit) {
        switch (unit) {
            case 'm': return distance;
            case 'km': return distance * 1000;
            case 'mi': return distance * 1609.344;
            case 'ft': return distance / 3.28084;
            default: throw new Error("ERR unsupported unit provided. please use m, km, ft, mi");
        }
    }

    /**
     * Encode coordinates to geohash (simplified implementation)
     * Returns a numeric score for sorted set storage
     */
    encodeGeohash(longitude, latitude) {
        // Normalize to 0-1 range
        const lonNorm = (longitude + 180) / 360;
        const latNorm = (latitude + 90) / 180;
        
        // Simple interleaving for demonstration (Redis uses more sophisticated encoding)
        let hash = 0;
        let lonBits = Math.floor(lonNorm * 0x1FFFFF); // 21 bits
        let latBits = Math.floor(latNorm * 0x1FFFFF); // 21 bits
        
        // Interleave bits (simplified)
        for (let i = 0; i < 21; i++) {
            hash |= ((lonBits >> i) & 1) << (i * 2);
            hash |= ((latBits >> i) & 1) << (i * 2 + 1);
        }
        
        return hash;
    }

    /**
     * Get geohash string representation (base32)
     */
    geohashString(longitude, latitude, precision = 11) {
        const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
        
        let lonMin = -180, lonMax = 180;
        let latMin = -90, latMax = 90;
        let evenBit = true;
        let geohash = '';
        let bit = 0;
        let ch = 0;

        while (geohash.length < precision) {
            let mid;
            
            if (evenBit) {
                // longitude
                mid = (lonMin + lonMax) / 2;
                if (longitude >= mid) {
                    ch |= (1 << (4 - bit));
                    lonMin = mid;
                } else {
                    lonMax = mid;
                }
            } else {
                // latitude
                mid = (latMin + latMax) / 2;
                if (latitude >= mid) {
                    ch |= (1 << (4 - bit));
                    latMin = mid;
                } else {
                    latMax = mid;
                }
            }

            evenBit = !evenBit;

            if (bit < 4) {
                bit++;
            } else {
                geohash += base32[ch];
                bit = 0;
                ch = 0;
            }
        }

        return geohash;
    }

    /**
     * Serialize for RDB storage
     */
    toArray() {
        const result = [];
        for (const [member, coord] of this.coordinates.entries()) {
            result.push({
                member,
                longitude: coord.longitude,
                latitude: coord.latitude
            });
        }
        return result;
    }
}

/**
 * RedisBitmap - Bitmap/Bitfield data structure
 * Supports efficient bit operations and bitfield manipulations
 */
class RedisBitmap {
    constructor() {
        // Use Buffer for efficient bit storage
        this.buffer = Buffer.alloc(0);
        this.maxBitPosition = -1;
    }

    /**
     * Ensure buffer is large enough to hold the specified bit position
     * @param {number} bitPosition - Bit position to accommodate
     */
    ensureCapacity(bitPosition) {
        const requiredBytes = Math.ceil((bitPosition + 1) / 8);
        if (this.buffer.length < requiredBytes) {
            const newBuffer = Buffer.alloc(requiredBytes);
            this.buffer.copy(newBuffer);
            this.buffer = newBuffer;
        }
        this.maxBitPosition = Math.max(this.maxBitPosition, bitPosition);
    }

    /**
     * Set bit at specified position
     * @param {number} bitPosition - Bit position (0-based)
     * @param {number} value - Bit value (0 or 1)
     * @returns {number} Previous bit value
     */
    setbit(bitPosition, value) {
        if (bitPosition < 0) {
            throw new Error("ERR bit offset is not an integer or out of range");
        }

        value = value ? 1 : 0;
        this.ensureCapacity(bitPosition);

        const byteIndex = Math.floor(bitPosition / 8);
        const bitIndex = bitPosition % 8;
        const mask = 1 << (7 - bitIndex); // Big-endian bit ordering

        const previousValue = (this.buffer[byteIndex] & mask) ? 1 : 0;

        if (value) {
            this.buffer[byteIndex] |= mask;
        } else {
            this.buffer[byteIndex] &= ~mask;
        }

        return previousValue;
    }

    /**
     * Get bit at specified position
     * @param {number} bitPosition - Bit position (0-based)
     * @returns {number} Bit value (0 or 1)
     */
    getbit(bitPosition) {
        if (bitPosition < 0) {
            throw new Error("ERR bit offset is not an integer or out of range");
        }

        if (bitPosition > this.maxBitPosition) {
            return 0;
        }

        const byteIndex = Math.floor(bitPosition / 8);
        const bitIndex = bitPosition % 8;
        const mask = 1 << (7 - bitIndex); // Big-endian bit ordering

        return (this.buffer[byteIndex] & mask) ? 1 : 0;
    }

    /**
     * Count number of set bits in range
     * @param {number} start - Start byte (inclusive, -1 for beginning)
     * @param {number} end - End byte (inclusive, -1 for end)
     * @returns {number} Number of set bits
     */
    bitcount(start = 0, end = -1) {
        if (this.buffer.length === 0) {
            return 0;
        }

        // Handle negative indices
        const bufferLength = this.buffer.length;
        if (start < 0) start = bufferLength + start;
        if (end < 0) end = bufferLength + end;

        // Clamp to valid range
        start = Math.max(0, Math.min(start, bufferLength - 1));
        end = Math.max(0, Math.min(end, bufferLength - 1));

        if (start > end) {
            return 0;
        }

        let count = 0;
        for (let i = start; i <= end; i++) {
            count += this.popcount(this.buffer[i]);
        }

        return count;
    }

    /**
     * Find first bit set to specified value
     * @param {number} bit - Bit value to find (0 or 1)
     * @param {number} start - Start bit position
     * @param {number} end - End bit position (-1 for end)
     * @returns {number} Bit position or -1 if not found
     */
    bitpos(bit, start = 0, end = -1) {
        bit = bit ? 1 : 0;
        
        if (this.buffer.length === 0) {
            return bit === 0 ? 0 : -1;
        }

        const totalBits = this.buffer.length * 8;
        
        // Handle byte-based start/end if provided
        if (end === -1) {
            end = totalBits - 1;
        }

        start = Math.max(0, start);
        end = Math.min(end, totalBits - 1);

        for (let bitPos = start; bitPos <= end; bitPos++) {
            if (this.getbit(bitPos) === bit) {
                return bitPos;
            }
        }

        return -1;
    }

    /**
     * Perform bitwise operation with another bitmap
     * @param {string} operation - AND, OR, XOR, NOT
     * @param {RedisBitmap} other - Other bitmap (null for NOT)
     * @returns {RedisBitmap} Result bitmap
     */
    bitop(operation, other = null) {
        const result = new RedisBitmap();

        switch (operation.toUpperCase()) {
            case 'NOT':
                result.buffer = Buffer.alloc(this.buffer.length);
                for (let i = 0; i < this.buffer.length; i++) {
                    result.buffer[i] = ~this.buffer[i] & 0xFF;
                }
                result.maxBitPosition = this.maxBitPosition;
                break;

            case 'AND':
            case 'OR':
            case 'XOR':
                if (!other) {
                    throw new Error("ERR operation requires two operands");
                }
                
                const maxLength = Math.max(this.buffer.length, other.buffer.length);
                result.buffer = Buffer.alloc(maxLength);
                
                for (let i = 0; i < maxLength; i++) {
                    const byte1 = i < this.buffer.length ? this.buffer[i] : 0;
                    const byte2 = i < other.buffer.length ? other.buffer[i] : 0;
                    
                    switch (operation.toUpperCase()) {
                        case 'AND':
                            result.buffer[i] = byte1 & byte2;
                            break;
                        case 'OR':
                            result.buffer[i] = byte1 | byte2;
                            break;
                        case 'XOR':
                            result.buffer[i] = byte1 ^ byte2;
                            break;
                    }
                }
                
                result.maxBitPosition = Math.max(this.maxBitPosition, other.maxBitPosition);
                break;

            default:
                throw new Error("ERR operation must be AND, OR, XOR, or NOT");
        }

        return result;
    }

    /**
     * Get/Set/Increment bitfield values
     * @param {Array} operations - Array of bitfield operations
     * @returns {Array} Results of operations
     */
    bitfield(operations) {
        const results = [];
        let overflowBehavior = 'WRAP'; // Default overflow behavior

        for (const op of operations) {
            const { command, type, offset, value, behavior } = op;

            if (behavior) {
                overflowBehavior = behavior;
                continue; // OVERFLOW command doesn't return a value
            }

            const { signed, bits } = this.parseType(type);
            const bitOffset = this.parseOffset(offset, bits);

            switch (command.toUpperCase()) {
                case 'GET':
                    results.push(this.getBitfield(bitOffset, bits, signed));
                    break;
                case 'SET':
                    const oldValue = this.getBitfield(bitOffset, bits, signed);
                    this.setBitfield(bitOffset, bits, value, signed, overflowBehavior);
                    results.push(oldValue);
                    break;
                case 'INCRBY':
                    const currentValue = this.getBitfield(bitOffset, bits, signed);
                    const newValue = this.incrementBitfield(currentValue, value, bits, signed, overflowBehavior);
                    if (newValue !== null) {
                        this.setBitfield(bitOffset, bits, newValue, signed, overflowBehavior);
                        results.push(newValue);
                    } else {
                        results.push(null); // Overflow with FAIL behavior
                    }
                    break;
            }
        }

        return results;
    }

    /**
     * Parse bitfield type (e.g., "u8", "i16")
     * @param {string} type - Type string
     * @returns {Object} Parsed type info
     */
    parseType(type) {
        const match = type.match(/^([ui])(\d+)$/);
        if (!match) {
            throw new Error("ERR Invalid bitfield type");
        }

        const signed = match[1] === 'i';
        const bits = parseInt(match[2]);

        if (bits < 1 || bits > 64) {
            throw new Error("ERR Invalid bitfield type");
        }

        return { signed, bits };
    }

    /**
     * Parse bitfield offset
     * @param {string|number} offset - Offset (can include multiplier like "#1")
     * @param {number} bits - Number of bits for type-based offsets
     * @returns {number} Bit offset
     */
    parseOffset(offset, bits) {
        if (typeof offset === 'number') {
            return offset;
        }

        if (typeof offset === 'string' && offset.startsWith('#')) {
            const multiplier = parseInt(offset.substring(1));
            return multiplier * bits;
        }

        return parseInt(offset);
    }

    /**
     * Get bitfield value
     * @param {number} bitOffset - Bit offset
     * @param {number} bits - Number of bits
     * @param {boolean} signed - Whether value is signed
     * @returns {number} Value
     */
    getBitfield(bitOffset, bits, signed) {
        let value = 0;
        
        for (let i = 0; i < bits; i++) {
            const bit = this.getbit(bitOffset + i);
            value = (value << 1) | bit;
        }

        // Handle signed values
        if (signed && bits < 64) {
            const signBit = 1 << (bits - 1);
            if (value & signBit) {
                value -= (1 << bits);
            }
        }

        return value;
    }

    /**
     * Set bitfield value
     * @param {number} bitOffset - Bit offset
     * @param {number} bits - Number of bits
     * @param {number} value - Value to set
     * @param {boolean} signed - Whether value is signed
     * @param {string} overflowBehavior - WRAP, SAT, or FAIL
     */
    setBitfield(bitOffset, bits, value, signed, overflowBehavior) {
        // Apply overflow behavior
        value = this.applyOverflow(value, bits, signed, overflowBehavior);

        // Ensure value fits in specified bits
        const mask = (1 << bits) - 1;
        value = value & mask;

        // Set bits from most significant to least significant
        for (let i = 0; i < bits; i++) {
            const bit = (value >> (bits - 1 - i)) & 1;
            this.setbit(bitOffset + i, bit);
        }
    }

    /**
     * Increment bitfield value
     * @param {number} currentValue - Current value
     * @param {number} increment - Increment amount
     * @param {number} bits - Number of bits
     * @param {boolean} signed - Whether value is signed
     * @param {string} overflowBehavior - WRAP, SAT, or FAIL
     * @returns {number|null} New value or null if overflow with FAIL
     */
    incrementBitfield(currentValue, increment, bits, signed, overflowBehavior) {
        const newValue = currentValue + increment;
        
        // Check for overflow
        const maxValue = signed ? (1 << (bits - 1)) - 1 : (1 << bits) - 1;
        const minValue = signed ? -(1 << (bits - 1)) : 0;

        if (newValue > maxValue || newValue < minValue) {
            if (overflowBehavior === 'FAIL') {
                return null;
            }
        }

        return this.applyOverflow(newValue, bits, signed, overflowBehavior);
    }

    /**
     * Apply overflow behavior to value
     * @param {number} value - Value to process
     * @param {number} bits - Number of bits
     * @param {boolean} signed - Whether value is signed
     * @param {string} overflowBehavior - WRAP, SAT, or FAIL
     * @returns {number} Processed value
     */
    applyOverflow(value, bits, signed, overflowBehavior) {
        const maxValue = signed ? (1 << (bits - 1)) - 1 : (1 << bits) - 1;
        const minValue = signed ? -(1 << (bits - 1)) : 0;

        if (value >= minValue && value <= maxValue) {
            return value;
        }

        switch (overflowBehavior.toUpperCase()) {
            case 'WRAP':
                if (signed) {
                    const range = 1 << bits;
                    value = ((value - minValue) % range + range) % range + minValue;
                } else {
                    value = value & ((1 << bits) - 1);
                }
                break;
            case 'SAT':
                value = Math.max(minValue, Math.min(maxValue, value));
                break;
            case 'FAIL':
                // Return original value, caller should handle failure
                break;
        }

        return value;
    }

    /**
     * Population count (number of set bits in a byte)
     * @param {number} byte - Byte value
     * @returns {number} Number of set bits
     */
    popcount(byte) {
        let count = 0;
        while (byte) {
            count += byte & 1;
            byte >>>= 1;
        }
        return count;
    }

    /**
     * Get bitmap size in bytes
     * @returns {number} Size in bytes
     */
    size() {
        return this.buffer.length;
    }

    /**
     * Check if bitmap is empty
     * @returns {boolean} True if empty
     */
    isEmpty() {
        return this.buffer.length === 0;
    }

    /**
     * Serialize for RDB storage
     * @returns {Object} Serialized data
     */
    toArray() {
        return {
            buffer: this.buffer.toString('base64'),
            maxBitPosition: this.maxBitPosition
        };
    }

    /**
     * Deserialize from RDB storage
     * @param {Object} data - Serialized data
     */
    fromArray(data) {
        this.buffer = Buffer.from(data.buffer, 'base64');
        this.maxBitPosition = data.maxBitPosition || -1;
    }
}

/**
 * RedisStream - Stream data structure for time-ordered data records
 * Supports consumer groups, pending entries, and distributed processing
 */
class RedisStream {
    constructor() {
        // Stream entries stored as Map: id -> {fields: {key: value, ...}, addTime: timestamp}
        this.entries = new Map();
        
        // Consumer groups: groupName -> {id, consumers: Map, pel: Map, lastDeliveredId}
        this.consumerGroups = new Map();
        
        // Stream metadata
        this.lastGeneratedId = '0-0';
        this.maxLength = null; // For XTRIM
        this.radixTreeApprox = false; // For XTRIM with ~
        
        // Global entry counter for sequence numbers
        this.entryCounter = 0;
    }

    /**
     * Generate unique stream entry ID
     * @param {string} id - Explicit ID or '*' for auto-generation
     * @returns {string} Generated or validated ID
     */
    generateId(id = '*') {
        if (id === '*') {
            const now = Date.now();
            const lastTimestamp = this.parseId(this.lastGeneratedId).timestamp;
            
            if (now > lastTimestamp) {
                this.lastGeneratedId = `${now}-0`;
            } else if (now === lastTimestamp) {
                const lastSequence = this.parseId(this.lastGeneratedId).sequence;
                this.lastGeneratedId = `${now}-${lastSequence + 1}`;
            } else {
                // Clock went backwards, use last timestamp + 1 sequence
                this.lastGeneratedId = `${lastTimestamp}-${this.parseId(this.lastGeneratedId).sequence + 1}`;
            }
            return this.lastGeneratedId;
        } else {
            // Validate explicit ID format
            if (!this.isValidId(id)) {
                throw new Error("ERR Invalid stream ID specified as stream command argument");
            }
            
            // Check if ID is greater than last generated ID
            if (this.compareIds(id, this.lastGeneratedId) <= 0 && this.lastGeneratedId !== '0-0') {
                throw new Error("ERR The ID specified in XADD is equal or smaller than the target stream top item");
            }
            
            this.lastGeneratedId = id;
            return id;
        }
    }

    /**
     * Parse stream ID into timestamp and sequence components
     * @param {string} id - Stream ID (e.g., "1609459200000-0")
     * @returns {Object} Parsed ID with timestamp and sequence
     */
    parseId(id) {
        const parts = id.split('-');
        if (parts.length !== 2) {
            throw new Error("ERR Invalid stream ID specified");
        }
        
        const timestamp = parseInt(parts[0]);
        const sequence = parseInt(parts[1]);
        
        if (isNaN(timestamp) || isNaN(sequence) || timestamp < 0 || sequence < 0) {
            throw new Error("ERR Invalid stream ID specified");
        }
        
        return { timestamp, sequence };
    }

    /**
     * Validate stream ID format
     * @param {string} id - Stream ID to validate
     * @returns {boolean} True if valid
     */
    isValidId(id) {
        try {
            this.parseId(id);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Compare two stream IDs
     * @param {string} id1 - First ID
     * @param {string} id2 - Second ID  
     * @returns {number} -1 if id1 < id2, 0 if equal, 1 if id1 > id2
     */
    compareIds(id1, id2) {
        const parsed1 = this.parseId(id1);
        const parsed2 = this.parseId(id2);
        
        if (parsed1.timestamp !== parsed2.timestamp) {
            return parsed1.timestamp < parsed2.timestamp ? -1 : 1;
        }
        
        if (parsed1.sequence !== parsed2.sequence) {
            return parsed1.sequence < parsed2.sequence ? -1 : 1;
        }
        
        return 0;
    }

    /**
     * Add entry to stream
     * @param {string} id - Entry ID or '*' for auto-generation
     * @param {Array} fieldValues - Array of [field, value, field, value, ...]
     * @returns {string} Generated entry ID
     */
    xadd(id, fieldValues) {
        if (fieldValues.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for XADD");
        }
        
        const entryId = this.generateId(id);
        
        // Convert field-value pairs to object
        const fields = {};
        for (let i = 0; i < fieldValues.length; i += 2) {
            fields[fieldValues[i]] = fieldValues[i + 1];
        }
        
        // Add entry
        this.entries.set(entryId, {
            fields: fields,
            addTime: Date.now()
        });
        
        // Trim stream if max length is set
        if (this.maxLength !== null) {
            this.trimToLength(this.maxLength, this.radixTreeApprox);
        }
        
        return entryId;
    }

    /**
     * Get stream length
     * @returns {number} Number of entries in stream
     */
    xlen() {
        return this.entries.size;
    }

    /**
     * Get range of entries
     * @param {string} start - Start ID (inclusive) or '-' for first
     * @param {string} end - End ID (inclusive) or '+' for last
     * @param {number} count - Maximum number of entries to return
     * @returns {Array} Array of [id, [field, value, field, value, ...]]
     */
    xrange(start, end, count = -1) {
        const entries = [];
        const startId = start === '-' ? this.getFirstId() : start;
        const endId = end === '+' ? this.getLastId() : end;
        
        if (!startId || !endId) {
            return entries; // Empty stream
        }
        
        for (const [id, entry] of this.entries) {
            if (this.compareIds(id, startId) >= 0 && this.compareIds(id, endId) <= 0) {
                const fieldArray = [];
                for (const [field, value] of Object.entries(entry.fields)) {
                    fieldArray.push(field, value);
                }
                entries.push([id, fieldArray]);
                
                if (count > 0 && entries.length >= count) {
                    break;
                }
            }
        }
        
        return entries;
    }

    /**
     * Get reverse range of entries
     * @param {string} start - Start ID (inclusive) or '+' for last
     * @param {string} end - End ID (inclusive) or '-' for first
     * @param {number} count - Maximum number of entries to return
     * @returns {Array} Array of [id, [field, value, field, value, ...]]
     */
    xrevrange(start, end, count = -1) {
        const entries = [];
        const startId = start === '+' ? this.getLastId() : start;
        const endId = end === '-' ? this.getFirstId() : end;
        
        if (!startId || !endId) {
            return entries; // Empty stream
        }
        
        // Get all entries in reverse order
        const allEntries = Array.from(this.entries.entries()).reverse();
        
        for (const [id, entry] of allEntries) {
            if (this.compareIds(id, startId) <= 0 && this.compareIds(id, endId) >= 0) {
                const fieldArray = [];
                for (const [field, value] of Object.entries(entry.fields)) {
                    fieldArray.push(field, value);
                }
                entries.push([id, fieldArray]);
                
                if (count > 0 && entries.length >= count) {
                    break;
                }
            }
        }
        
        return entries;
    }

    /**
     * Delete entries from stream
     * @param {Array} ids - Array of entry IDs to delete
     * @returns {number} Number of entries deleted
     */
    xdel(ids) {
        let deletedCount = 0;
        
        for (const id of ids) {
            if (this.entries.has(id)) {
                this.entries.delete(id);
                deletedCount++;
                
                // Remove from all consumer group PELs
                for (const group of this.consumerGroups.values()) {
                    if (group.pel.has(id)) {
                        group.pel.delete(id);
                    }
                }
            }
        }
        
        return deletedCount;
    }

    /**
     * Trim stream to specified length
     * @param {number} maxLen - Maximum length to keep
     * @param {boolean} approximate - Use approximate trimming (~)
     * @returns {number} Number of entries removed
     */
    xtrim(maxLen, approximate = false) {
        this.maxLength = maxLen;
        this.radixTreeApprox = approximate;
        return this.trimToLength(maxLen, approximate);
    }

    /**
     * Internal method to trim stream to length
     * @param {number} maxLen - Maximum length
     * @param {boolean} approximate - Use approximate trimming
     * @returns {number} Number of entries removed
     */
    trimToLength(maxLen, approximate = false) {
        const currentLen = this.entries.size;
        if (currentLen <= maxLen) {
            return 0;
        }
        
        const toRemove = currentLen - maxLen;
        const entriesToRemove = Array.from(this.entries.keys()).slice(0, toRemove);
        
        for (const id of entriesToRemove) {
            this.entries.delete(id);
            
            // Remove from all consumer group PELs
            for (const group of this.consumerGroups.values()) {
                if (group.pel.has(id)) {
                    group.pel.delete(id);
                }
            }
        }
        
        return toRemove;
    }

    /**
     * Get first entry ID in stream
     * @returns {string|null} First entry ID or null if empty
     */
    getFirstId() {
        const keys = Array.from(this.entries.keys());
        return keys.length > 0 ? keys[0] : null;
    }

    /**
     * Get last entry ID in stream
     * @returns {string|null} Last entry ID or null if empty
     */
    getLastId() {
        const keys = Array.from(this.entries.keys());
        return keys.length > 0 ? keys[keys.length - 1] : null;
    }

    /**
     * Create consumer group
     * @param {string} groupName - Name of the consumer group
     * @param {string} id - Starting ID for the group or '$' for latest
     * @returns {boolean} True if group created, false if already exists
     */
    xgroupCreate(groupName, id) {
        if (this.consumerGroups.has(groupName)) {
            return false; // Group already exists
        }
        
        let lastDeliveredId = id;
        if (id === '$') {
            lastDeliveredId = this.getLastId() || '0-0';
        }
        
        this.consumerGroups.set(groupName, {
            id: lastDeliveredId,
            consumers: new Map(), // consumerName -> {name, pending: Map, lastSeen: timestamp}
            pel: new Map(), // entryId -> {consumer, deliveryTime, deliveryCount}
            lastDeliveredId: lastDeliveredId
        });
        
        return true;
    }

    /**
     * Destroy consumer group
     * @param {string} groupName - Name of the consumer group
     * @returns {boolean} True if group destroyed, false if didn't exist
     */
    xgroupDestroy(groupName) {
        return this.consumerGroups.delete(groupName);
    }

    /**
     * Delete consumer from group
     * @param {string} groupName - Name of the consumer group
     * @param {string} consumerName - Name of the consumer
     * @returns {number} Number of pending entries for the consumer
     */
    xgroupDelConsumer(groupName, consumerName) {
        const group = this.consumerGroups.get(groupName);
        if (!group) {
            throw new Error("NOGROUP No such key 'streamkey' or consumer group 'groupname'");
        }
        
        const consumer = group.consumers.get(consumerName);
        if (!consumer) {
            return 0; // Consumer doesn't exist
        }
        
        // Remove consumer's pending entries
        const pendingCount = consumer.pending.size;
        for (const entryId of consumer.pending.keys()) {
            group.pel.delete(entryId);
        }
        
        // Remove consumer
        group.consumers.delete(consumerName);
        
        return pendingCount;
    }

    /**
     * Set last delivered ID for consumer group
     * @param {string} groupName - Name of the consumer group
     * @param {string} id - New last delivered ID
     * @returns {boolean} True if successful
     */
    xgroupSetId(groupName, id) {
        const group = this.consumerGroups.get(groupName);
        if (!group) {
            throw new Error("NOGROUP No such key or consumer group");
        }
        
        // Validate ID format
        if (!this.isValidId(id) && id !== '$') {
            throw new Error("ERR Invalid stream ID specified");
        }
        
        let newId = id;
        if (id === '$') {
            newId = this.getLastId() || '0-0';
        }
        
        group.lastDeliveredId = newId;
        group.id = newId;
        
        return true;
    }

    /**
     * Create consumer in group without reading
     * @param {string} groupName - Name of the consumer group
     * @param {string} consumerName - Name of the consumer
     * @returns {boolean} True if consumer created, false if already exists
     */
    xgroupCreateConsumer(groupName, consumerName) {
        const group = this.consumerGroups.get(groupName);
        if (!group) {
            throw new Error("NOGROUP No such key or consumer group");
        }
        
        if (group.consumers.has(consumerName)) {
            return false; // Consumer already exists
        }
        
        group.consumers.set(consumerName, {
            name: consumerName,
            pending: new Map(),
            lastSeen: Date.now()
        });
        
        return true;
    }

    /**
     * Set stream last generated ID
     * @param {string} id - New last generated ID
     * @returns {boolean} True if successful
     */
    xsetid(id) {
        // Validate ID format
        if (!this.isValidId(id) && id !== '$') {
            throw new Error("ERR Invalid stream ID specified");
        }
        
        let newId = id;
        if (id === '$') {
            newId = this.getLastId() || '0-0';
        }
        
        // Check if ID is valid (can't go backwards unless it's smaller than current entries)
        if (this.entries.size > 0) {
            const firstId = this.getFirstId();
            if (this.compareIds(newId, firstId) < 0) {
                throw new Error("ERR The ID specified in XSETID is smaller than the target stream top item");
            }
        }
        
        this.lastGeneratedId = newId;
        
        return true;
    }

    /**
     * Auto-claim pending entries from idle consumers
     * @param {string} groupName - Name of the consumer group
     * @param {string} consumerName - Name of the claiming consumer
     * @param {number} minIdleTime - Minimum idle time in milliseconds
     * @param {string} start - Starting ID for claiming
     * @param {number} count - Maximum number of entries to claim
     * @returns {Array} Array of [next_id, [claimed_entries]]
     */
    xautoclaim(groupName, consumerName, minIdleTime, start = '0-0', count = -1) {
        const group = this.consumerGroups.get(groupName);
        if (!group) {
            throw new Error("NOGROUP No such key or consumer group");
        }
        
        // Ensure claiming consumer exists
        if (!group.consumers.has(consumerName)) {
            group.consumers.set(consumerName, {
                name: consumerName,
                pending: new Map(),
                lastSeen: Date.now()
            });
        }
        
        const claimedEntries = [];
        const now = Date.now();
        let nextId = start;
        let claimedCount = 0;
        
        // Look for idle pending entries
        for (const [entryId, pelEntry] of group.pel) {
            if (this.compareIds(entryId, start) < 0) continue;
            if (count > 0 && claimedCount >= count) break;
            
            const idleTime = now - pelEntry.deliveryTime;
            if (idleTime >= minIdleTime) {
                // Claim this entry
                const oldConsumer = pelEntry.consumer;
                
                // Remove from old consumer's pending list
                if (group.consumers.has(oldConsumer)) {
                    group.consumers.get(oldConsumer).pending.delete(entryId);
                }
                
                // Add to new consumer's pending list
                group.consumers.get(consumerName).pending.set(entryId, {
                    deliveryTime: now,
                    deliveryCount: pelEntry.deliveryCount + 1
                });
                
                // Update PEL
                pelEntry.consumer = consumerName;
                pelEntry.deliveryTime = now;
                pelEntry.deliveryCount++;
                
                // Add entry to claimed list if it still exists in stream
                if (this.entries.has(entryId)) {
                    const entry = this.entries.get(entryId);
                    const fieldArray = [];
                    for (const [field, value] of Object.entries(entry.fields)) {
                        fieldArray.push(field, value);
                    }
                    claimedEntries.push([entryId, fieldArray]);
                }
                
                claimedCount++;
                
                // Update next ID
                const parsed = this.parseId(entryId);
                nextId = `${parsed.timestamp}-${parsed.sequence + 1}`;
            }
        }
        
        return [nextId, claimedEntries];
    }

    /**
     * Check if stream is empty
     * @returns {boolean} True if empty
     */
    isEmpty() {
        return this.entries.size === 0;
    }

    /**
     * Serialize for RDB storage
     * @returns {Object} Serialized data
     */
    toArray() {
        return {
            entries: Array.from(this.entries.entries()),
            consumerGroups: Array.from(this.consumerGroups.entries()).map(([name, group]) => [
                name, {
                    id: group.id,
                    consumers: Array.from(group.consumers.entries()),
                    pel: Array.from(group.pel.entries()),
                    lastDeliveredId: group.lastDeliveredId
                }
            ]),
            lastGeneratedId: this.lastGeneratedId,
            maxLength: this.maxLength,
            radixTreeApprox: this.radixTreeApprox,
            entryCounter: this.entryCounter
        };
    }

    /**
     * Deserialize from RDB storage
     * @param {Object} data - Serialized data
     */
    fromArray(data) {
        this.entries = new Map(data.entries || []);
        this.consumerGroups = new Map();
        
        // Restore consumer groups
        for (const [name, groupData] of data.consumerGroups || []) {
            this.consumerGroups.set(name, {
                id: groupData.id,
                consumers: new Map(groupData.consumers || []),
                pel: new Map(groupData.pel || []),
                lastDeliveredId: groupData.lastDeliveredId
            });
        }
        
        this.lastGeneratedId = data.lastGeneratedId || '0-0';
        this.maxLength = data.maxLength || null;
        this.radixTreeApprox = data.radixTreeApprox || false;
        this.entryCounter = data.entryCounter || 0;
    }
}

class RedisClone {
    constructor() {
        // In-memory storage for key-value pairs
        this.data = new Map();
        
        // Storage for data types (key -> type string)
        this.types = new Map();
        
        // Storage for key expiration times (key -> timestamp)
        this.expiration = new Map();
        
        // Check for --raw command line argument
        this.rawMode = process.argv.includes('--raw');
        
        // Transaction support
        this.inTransaction = false;
        this.transactionQueue = [];
        this.watchedKeys = new Set();
        this.watchedKeyValues = new Map(); // Store key values when WATCH is called
        
        // AOF (Append Only File) persistence support
        this.aofEnabled = process.argv.includes('--aof') || process.env.AOF_ENABLED === 'true';
        this.aofFilename = process.env.AOF_FILENAME || 'redis-clone.aof';
        this.aofSyncPolicy = process.env.AOF_SYNC_POLICY || 'everysec'; // always, everysec, no
        this.aofBuffer = [];
        this.aofLastSyncTime = Date.now();
        this.aofRewriteInProgress = false;
        
        // Load data from AOF file if it exists
        if (this.aofEnabled) {
            this.loadFromAOF();
            this.startAOFSyncTimer();
        }
        
        // RDB (Redis Database) snapshot persistence support
        this.rdbEnabled = process.argv.includes('--rdb') || process.env.RDB_ENABLED === 'true';
        this.rdbFilename = process.env.RDB_FILENAME || 'redis-clone.rdb';
        this.rdbSaveSeconds = parseInt(process.env.RDB_SAVE_SECONDS) || 300; // Default: 5 minutes
        this.rdbSaveChanges = parseInt(process.env.RDB_SAVE_CHANGES) || 1; // Default: 1 change
        this.rdbLastSaveTime = Date.now();
        this.rdbChangesSinceLastSave = 0;
        this.rdbBgsaveInProgress = false;
        this.rdbAutoSaveEnabled = this.rdbEnabled && (this.rdbSaveSeconds > 0);
        
        // Load data from RDB file if it exists (only if AOF is not enabled)
        if (this.rdbEnabled && !this.aofEnabled) {
            this.loadFromRDB();
        }
        
        // Start RDB auto-save timer if enabled
        if (this.rdbAutoSaveEnabled) {
            this.startRDBAutoSaveTimer();
        }
        
        // Start background cleanup for expired keys
        this.startExpirationCleanup();
        
        // Initialize CLI interface
        this.setupCLI();
        
        console.log('Redis-Clone Server started. Type "help" for available commands.');
        if (this.rawMode) {
            console.log('Raw mode enabled - formatting options will display properly.');
        }
        if (this.aofEnabled) {
            console.log(`AOF persistence enabled (${this.aofSyncPolicy} sync policy) - data will be persisted to ${this.aofFilename}`);
        }
        if (this.rdbEnabled) {
            if (this.rdbAutoSaveEnabled) {
                console.log(`RDB snapshots enabled - auto-save every ${this.rdbSaveSeconds}s if ${this.rdbSaveChanges}+ changes, saved to ${this.rdbFilename}`);
            } else {
                console.log(`RDB snapshots enabled - manual snapshots only, saved to ${this.rdbFilename}`);
            }
        }
        console.log('Use QUIT or Ctrl+C to exit.\n');
    }

    /**
     * Start background cleanup for expired keys
     */
    startExpirationCleanup() {
        // Check for expired keys every 1 second
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredKeys();
        }, 1000);
    }

    /**
     * Clean up expired keys from storage
     */
    cleanupExpiredKeys() {
        const now = Date.now();
        for (const [key, expireTime] of this.expiration.entries()) {
            if (now >= expireTime) {
                this.deleteKey(key);
            }
        }
    }

    /**
     * Check if a key has expired
     * @param {string} key - Key to check
     * @returns {boolean} - True if key has expired
     */
    isKeyExpired(key) {
        if (!this.expiration.has(key)) {
            return false;
        }
        
        const expireTime = this.expiration.get(key);
        const now = Date.now();
        
        if (now >= expireTime) {
            // Key has expired, clean it up immediately
            this.deleteKey(key);
            return true;
        }
        
        return false;
    }

    /**
     * Get value checking for expiration
     * @param {string} key - Key to get
     * @returns {any} - Value or undefined if expired/missing
     */
    getValue(key) {
        if (this.isKeyExpired(key)) {
            return undefined;
        }
        return this.data.get(key);
    }

    /**
     * Get the type of a key
     * @param {string} key - Key to check
     * @returns {string} - Type name or 'none' if key doesn't exist
     */
    getType(key) {
        if (this.isKeyExpired(key) || !this.data.has(key)) {
            return 'none';
        }
        return this.types.get(key) || 'string';
    }

    /**
     * Check if key exists and is of expected type
     * @param {string} key - Key to check
     * @param {string} expectedType - Expected type
     * @throws {Error} - If type mismatch
     */
    checkType(key, expectedType) {
        const actualType = this.getType(key);
        if (actualType !== 'none' && actualType !== expectedType) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }
    }

    /**
     * Set value with type tracking
     * @param {string} key - Key to set
     * @param {any} value - Value to set
     * @param {string} type - Type of the value
     */
    setValue(key, value, type = 'string') {
        this.data.set(key, value);
        this.types.set(key, type);
    }

    /**
     * Delete key and clean up all related data
     * @param {string} key - Key to delete
     */
    deleteKey(key) {
        this.data.delete(key);
        this.types.delete(key);
        this.expiration.delete(key);
    }

    /**
     * Set up the command line interface
     */
    setupCLI() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'redis-clone> '
        });

        this.rl.prompt();

        this.rl.on('line', (input) => {
            const result = this.processCommand(input.trim());
            if (result !== null) {
                // Handle raw mode for proper JSON formatting
                if (this.rawMode && typeof result === 'string') {
                    this.displayRawOutput(result);
                } else {
                    console.log(result);
                }
            }
            this.rl.prompt();
        });

        this.rl.on('close', () => {
            // Clean up background timer
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
            }
            console.log('\nGoodbye!');
            process.exit(0);
        });

        // Handle Ctrl+C gracefully
        process.on('SIGINT', () => {
            this.rl.close();
        });
    }

    /**
     * Display output in raw mode with proper formatting
     * @param {string} result - Command result to display
     */
    displayRawOutput(result) {
        // Check if this looks like a JSON formatting result
        if (result.includes('\\n') || result.includes('\\t')) {
            // Convert escaped characters to actual formatting
            let formatted = result;
            formatted = formatted.replace(/\\n/g, '\n');
            formatted = formatted.replace(/\\t/g, '\t');
            formatted = formatted.replace(/\\"/g, '"');
            
            // Remove surrounding quotes if present for JSON output
            if (formatted.startsWith('"') && formatted.endsWith('"')) {
                formatted = formatted.slice(1, -1);
            }
            
            console.log(formatted);
        } else {
            // Regular output
            console.log(result);
        }
    }

    /**
     * Process incoming commands
     * @param {string} input - Raw command input
     * @returns {string|null} - Command result or null for quit
     */
    processCommand(input) {
        if (!input) {
            return '';
        }

        // Parse command and arguments
        const args = this.parseCommand(input);
        if (args.length === 0) {
            return '';
        }

        const command = args[0].toUpperCase();
        const commandArgs = args.slice(1);

        try {
            // Handle transaction commands that don't get queued
            switch (command) {
                case 'HELP':
                    return this.help();
                case 'RAW':
                    return this.toggleRawMode(args);
                case 'MULTI':
                    return this.multi(commandArgs);
                case 'EXEC':
                    return this.exec(commandArgs);
                case 'DISCARD':
                    return this.discard(commandArgs);
                case 'WATCH':
                    return this.watch(commandArgs);
                case 'UNWATCH':
                    return this.unwatch(commandArgs);
                case 'BGREWRITEAOF':
                    return this.bgrewriteaof(commandArgs);
                case 'SAVE':
                    return this.save(commandArgs);
                case 'BGSAVE':
                    return this.bgsave(commandArgs);
                case 'LASTSAVE':
                    return this.lastsave(commandArgs);
                // Phase 12 commands - Geospatial Data
                case 'GEOADD':
                    return this.geoadd(commandArgs);
                case 'GEODIST':
                    return this.geodist(commandArgs);
                case 'GEOPOS':
                    return this.geopos(commandArgs);
                case 'GEOHASH':
                    return this.geohash(commandArgs);
                case 'GEORADIUS':
                    return this.georadius(commandArgs);
                case 'GEORADIUSBYMEMBER':
                    return this.georadiusbymember(commandArgs);
                case 'GEOSEARCH':
                    return this.geosearch(commandArgs);
                case 'GEOSEARCHSTORE':
                    return this.geosearchstore(commandArgs);
                // Phase 13 commands - Bitmaps & Bitfields
                case 'SETBIT':
                    return this.setbit(commandArgs);
                case 'GETBIT':
                    return this.getbit(commandArgs);
                case 'BITCOUNT':
                    return this.bitcount(commandArgs);
                case 'BITPOS':
                    return this.bitpos(commandArgs);
                case 'BITOP':
                    return this.bitop(commandArgs);
                case 'BITFIELD':
                    return this.bitfield(commandArgs);
                case 'BITFIELD_RO':
                    return this.bitfieldRo(commandArgs);
                // Phase 14 commands - Streams
                case 'XADD':
                    return this.xadd(commandArgs);
                case 'XREAD':
                    return this.xread(commandArgs);
                case 'XRANGE':
                    return this.xrange(commandArgs);
                case 'XREVRANGE':
                    return this.xrevrange(commandArgs);
                case 'XLEN':
                    return this.xlen(commandArgs);
                case 'XTRIM':
                    return this.xtrim(commandArgs);
                case 'XDEL':
                    return this.xdel(commandArgs);
                case 'XGROUP':
                    return this.xgroup(commandArgs);
                case 'XREADGROUP':
                    return this.xreadgroup(commandArgs);
                case 'XACK':
                    return this.xack(commandArgs);
                case 'XPENDING':
                    return this.xpending(commandArgs);
                case 'XCLAIM':
                    return this.xclaim(commandArgs);
                case 'XINFO':
                    return this.xinfo(commandArgs);
                case 'XSETID':
                    return this.xsetid(commandArgs);
                case 'XAUTOCLAIM':
                    return this.xautoclaim(commandArgs);
                case 'QUIT':
                case 'EXIT':
                    // Sync AOF before exit to ensure persistence
                    if (this.aofEnabled) {
                        this.syncAOF();
                        console.log('AOF synchronized before shutdown.');
                    }
                    // Save RDB snapshot before exit if enabled and there are unsaved changes
                    if (this.rdbEnabled && this.rdbChangesSinceLastSave > 0) {
                        try {
                            const keyCount = this.createRDBSnapshot();
                            console.log(`RDB snapshot saved before shutdown: ${keyCount} keys.`);
                        } catch (error) {
                            console.error(`Error saving RDB on shutdown: ${error.message}`);
                        }
                    }
                    this.rl.close();
                    return null;
            }

            // If we're in a transaction, queue the command instead of executing it
            if (this.inTransaction) {
                this.transactionQueue.push({ command, args: commandArgs });
                return 'QUEUED';
            }

            // Log write commands to AOF before execution (for direct CLI commands)
            if (this.isWriteCommand(command)) {
                this.logToAOF(command, commandArgs);
                // Increment RDB changes counter for auto-save
                if (this.rdbEnabled) {
                    this.rdbChangesSinceLastSave++;
                }
            }

            // Execute commands normally when not in transaction
            switch (command) {
                // Phase 1 commands
                case 'SET':
                    return this.set(commandArgs);
                case 'GET':
                    return this.get(commandArgs);
                case 'DEL':
                    return this.del(commandArgs);
                case 'EXISTS':
                    return this.exists(commandArgs);
                case 'KEYS':
                    return this.keys(commandArgs);
                case 'FLUSHALL':
                    return this.flushall();
                case 'MSET':
                    return this.mset(commandArgs);
                case 'MGET':
                    return this.mget(commandArgs);
                case 'GETSET':
                    return this.getset(commandArgs);
                case 'SETNX':
                    return this.setnx(commandArgs);
                case 'GETRANGE':
                case 'SUBSTR':
                    return this.getrange(commandArgs);
                case 'SETRANGE':
                    return this.setrange(commandArgs);
                case 'DBSIZE':
                    return this.dbsize(commandArgs);
                case 'RANDOMKEY':
                    return this.randomkey(commandArgs);
                // Phase 2 commands - String Operations
                case 'APPEND':
                    return this.append(commandArgs);
                case 'STRLEN':
                    return this.strlen(commandArgs);
                // Phase 2 commands - Atomic Operations
                case 'INCR':
                    return this.incr(commandArgs);
                case 'DECR':
                    return this.decr(commandArgs);
                case 'INCRBY':
                    return this.incrby(commandArgs);
                case 'DECRBY':
                    return this.decrby(commandArgs);
                case 'INCRBYFLOAT':
                    return this.incrbyfloat(commandArgs);
                case 'MSETNX':
                    return this.msetnx(commandArgs);
                case 'GETDEL':
                    return this.getdel(commandArgs);
                case 'LCS':
                    return this.lcs(commandArgs);
                // Phase 2 commands - Expiration
                case 'EXPIRE':
                    return this.expire(commandArgs);
                case 'PEXPIRE':
                    return this.pexpire(commandArgs);
                case 'TTL':
                    return this.ttl(commandArgs);
                case 'PTTL':
                    return this.pttl(commandArgs);
                case 'PERSIST':
                    return this.persist(commandArgs);
                // Phase 2 commands - Key Management
                case 'RENAME':
                    return this.rename(commandArgs);
                case 'RENAMENX':
                    return this.renamenx(commandArgs);
                case 'EXPIREAT':
                    return this.expireat(commandArgs);
                case 'PEXPIREAT':
                    return this.pexpireat(commandArgs);
                case 'SETEX':
                    return this.setex(commandArgs);
                case 'PSETEX':
                    return this.psetex(commandArgs);
                case 'GETEX':
                    return this.getex(commandArgs);
                // Phase 3 commands - List Operations
                case 'LPUSH':
                    return this.lpush(commandArgs);
                case 'RPUSH':
                    return this.rpush(commandArgs);
                case 'LPOP':
                    return this.lpop(commandArgs);
                case 'RPOP':
                    return this.rpop(commandArgs);
                case 'LLEN':
                    return this.llen(commandArgs);
                case 'LRANGE':
                    return this.lrange(commandArgs);
                case 'LINDEX':
                    return this.lindex(commandArgs);
                case 'LSET':
                    return this.lset(commandArgs);
                case 'LTRIM':
                    return this.ltrim(commandArgs);
                case 'LINSERT':
                    return this.linsert(commandArgs);
                case 'LPUSHX':
                    return this.lpushx(commandArgs);
                case 'RPUSHX':
                    return this.rpushx(commandArgs);
                case 'LREM':
                    return this.lrem(commandArgs);
                case 'RPOPLPUSH':
                    return this.rpoplpush(commandArgs);
                case 'LMOVE':
                    return this.lmove(commandArgs);
                case 'LPOS':
                    return this.lpos(commandArgs);
                case 'LMPOP':
                    return this.lmpop(commandArgs);
                case 'BLPOP':
                    return this.blpop(commandArgs);
                case 'BRPOP':
                    return this.brpop(commandArgs);
                case 'BRPOPLPUSH':
                    return this.brpoplpush(commandArgs);
                case 'BLMOVE':
                    return this.blmove(commandArgs);
                case 'BLMPOP':
                    return this.blmpop(commandArgs);
                // Phase 4 commands - Set Operations
                case 'SADD':
                    return this.sadd(commandArgs);
                case 'SREM':
                    return this.srem(commandArgs);
                case 'SMEMBERS':
                    return this.smembers(commandArgs);
                case 'SCARD':
                    return this.scard(commandArgs);
                case 'SISMEMBER':
                    return this.sismember(commandArgs);
                case 'SUNION':
                    return this.sunion(commandArgs);
                case 'SINTER':
                    return this.sinter(commandArgs);
                case 'SDIFF':
                    return this.sdiff(commandArgs);
                case 'SPOP':
                    return this.spop(commandArgs);
                case 'SRANDMEMBER':
                    return this.srandmember(commandArgs);
                case 'SMOVE':
                    return this.smove(commandArgs);
                case 'SUNIONSTORE':
                    return this.sunionstore(commandArgs);
                case 'SINTERSTORE':
                    return this.sinterstore(commandArgs);
                case 'SDIFFSTORE':
                    return this.sdiffstore(commandArgs);
                case 'SINTERCARD':
                    return this.sintercard(commandArgs);
                case 'SMISMEMBER':
                    return this.smismember(commandArgs);
                case 'SSCAN':
                    return this.sscan(commandArgs);
                // Phase 5 commands - Hash Operations
                case 'HSET':
                    return this.hset(commandArgs);
                case 'HGET':
                    return this.hget(commandArgs);
                case 'HMGET':
                    return this.hmget(commandArgs);
                case 'HGETALL':
                    return this.hgetall(commandArgs);
                case 'HDEL':
                    return this.hdel(commandArgs);
                case 'HEXISTS':
                    return this.hexists(commandArgs);
                case 'HKEYS':
                    return this.hkeys(commandArgs);
                case 'HVALS':
                    return this.hvals(commandArgs);
                case 'HLEN':
                    return this.hlen(commandArgs);
                case 'HINCRBY':
                    return this.hincrby(commandArgs);
                case 'HINCRBYFLOAT':
                    return this.hincrbyfloat(commandArgs);
                case 'HSETNX':
                    return this.hsetnx(commandArgs);
                case 'HMSET':
                    return this.hmset(commandArgs);
                case 'HSTRLEN':
                    return this.hstrlen(commandArgs);
                case 'HSCAN':
                    return this.hscan(commandArgs);
                case 'HRANDFIELD':
                    return this.hrandfield(commandArgs);
                case 'HGETDEL':
                    return this.hgetdel(commandArgs);
                case 'HEXPIRE':
                    return this.hexpire(commandArgs);
                case 'HEXPIREAT':
                    return this.hexpireat(commandArgs);
                case 'HEXPIRETIME':
                    return this.hexpiretime(commandArgs);
                case 'HPEXPIRE':
                    return this.hpexpire(commandArgs);
                case 'HPEXPIREAT':
                    return this.hpexpireat(commandArgs);
                case 'HPEXPIRETIME':
                    return this.hpexpiretime(commandArgs);
                case 'HTTL':
                    return this.httl(commandArgs);
                case 'HPTTL':
                    return this.hpttl(commandArgs);
                case 'HPERSIST':
                    return this.hpersist(commandArgs);
                // Phase 6 commands - Sorted Set Operations
                case 'ZADD':
                    return this.zadd(commandArgs);
                case 'ZREM':
                    return this.zrem(commandArgs);
                case 'ZSCORE':
                    return this.zscore(commandArgs);
                case 'ZRANK':
                    return this.zrank(commandArgs);
                case 'ZREVRANK':
                    return this.zrevrank(commandArgs);
                case 'ZRANGE':
                    return this.zrange(commandArgs);
                case 'ZREVRANGE':
                    return this.zrevrange(commandArgs);
                case 'ZRANGEBYSCORE':
                    return this.zrangebyscore(commandArgs);
                case 'ZREVRANGEBYSCORE':
                    return this.zrevrangebyscore(commandArgs);
                case 'ZCOUNT':
                    return this.zcount(commandArgs);
                case 'ZCARD':
                    return this.zcard(commandArgs);
                case 'ZINCRBY':
                    return this.zincrby(commandArgs);
                case 'ZREMRANGEBYRANK':
                    return this.zremrangebyrank(commandArgs);
                case 'ZREMRANGEBYSCORE':
                    return this.zremrangebyscore(commandArgs);
                case 'ZRANGEBYLEX':
                    return this.zrangebylex(commandArgs);
                case 'ZREVRANGEBYLEX':
                    return this.zrevrangebylex(commandArgs);
                case 'ZLEXCOUNT':
                    return this.zlexcount(commandArgs);
                case 'ZREMRANGEBYLEX':
                    return this.zremrangebylex(commandArgs);
                case 'ZPOPMIN':
                    return this.zpopmin(commandArgs);
                case 'ZPOPMAX':
                    return this.zpopmax(commandArgs);
                case 'ZSCAN':
                    return this.zscan(commandArgs);
                case 'ZUNIONSTORE':
                    return this.zunionstore(commandArgs);
                case 'ZINTERSTORE':
                    return this.zinterstore(commandArgs);
                case 'ZMSCORE':
                    return this.zmscore(commandArgs);
                case 'ZRANDMEMBER':
                    return this.zrandmember(commandArgs);
                case 'ZUNION':
                    return this.zunion(commandArgs);
                case 'ZINTER':
                    return this.zinter(commandArgs);
                case 'ZDIFF':
                    return this.zdiff(commandArgs);
                case 'ZDIFFSTORE':
                    return this.zdiffstore(commandArgs);
                case 'ZINTERCARD':
                    return this.zintercard(commandArgs);
                case 'ZMPOP':
                    return this.zmpop(commandArgs);
                case 'ZRANGESTORE':
                    return this.zrangestore(commandArgs);
                case 'BZPOPMIN':
                    return this.bzpopmin(commandArgs);
                case 'BZPOPMAX':
                    return this.bzpopmax(commandArgs);
                case 'BZMPOP':
                    return this.bzmpop(commandArgs);
                // Phase 7 commands - JSON Support
                case 'JSON.GET':
                    return this.jsonGet(commandArgs);
                case 'JSON.SET':
                    return this.jsonSet(commandArgs);
                case 'JSON.DEL':
                    return this.jsonDel(commandArgs);
                case 'JSON.TYPE':
                    return this.jsonType(commandArgs);
                case 'JSON.STRLEN':
                    return this.jsonStrlen(commandArgs);
                case 'JSON.MGET':
                    return this.jsonMget(commandArgs);
                case 'JSON.ARRAPPEND':
                    return this.jsonArrappend(commandArgs);
                case 'JSON.ARRLEN':
                    return this.jsonArrlen(commandArgs);
                case 'JSON.ARRINDEX':
                    return this.jsonArrindex(commandArgs);
                case 'JSON.ARRINSERT':
                    return this.jsonArrinsert(commandArgs);
                case 'JSON.ARRPOP':
                    return this.jsonArrpop(commandArgs);
                case 'JSON.ARRTRIM':
                    return this.jsonArrtrim(commandArgs);
                case 'JSON.OBJKEYS':
                    return this.jsonObjkeys(commandArgs);
                case 'JSON.OBJLEN':
                    return this.jsonObjlen(commandArgs);
                case 'JSON.NUMINCRBY':
                    return this.jsonNumincrby(commandArgs);
                case 'JSON.NUMMULTBY':
                    return this.jsonNummultby(commandArgs);
                case 'JSON.CLEAR':
                    return this.jsonClear(commandArgs);
                case 'JSON.FORGET':
                    return this.jsonForget(commandArgs);
                case 'JSON.RESP':
                    return this.jsonResp(commandArgs);
                case 'JSON.DEBUG':
                    return this.jsonDebug(commandArgs);
                case 'JSON.MSET':
                    return this.jsonMset(commandArgs);
                case 'JSON.MERGE':
                    return this.jsonMerge(commandArgs);
                case 'JSON.STRAPPEND':
                    return this.jsonStrappend(commandArgs);
                case 'JSON.TOGGLE':
                    return this.jsonToggle(commandArgs);
                // Debug command
                case 'TYPE':
                    return this.type(commandArgs);
                default:
                    return `(error) ERR unknown command '${command}'`;
            }
        } catch (error) {
            return `(error) ${error.message}`;
        }
    }

    /**
     * Parse command string into arguments, handling quoted strings
     * @param {string} input - Command string
     * @returns {Array<string>} - Array of command arguments
     */
    parseCommand(input) {
        const args = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            
            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuotes) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current) {
            args.push(current);
        }

        return args;
    }

    /**
     * Toggle raw mode on/off
     * @param {Array<string>} args - Command arguments
     */
    toggleRawMode(args) {
        if (args.length > 1) {
            const mode = args[1].toLowerCase();
            if (mode === 'on' || mode === 'true' || mode === '1') {
                this.rawMode = true;
                return 'Raw mode enabled - JSON formatting will display properly';
            } else if (mode === 'off' || mode === 'false' || mode === '0') {
                this.rawMode = false;
                return 'Raw mode disabled - output will show escaped characters';
            } else {
                return `ERR invalid raw mode argument: ${mode}. Use 'on' or 'off'`;
            }
        } else {
            // Toggle current mode
            this.rawMode = !this.rawMode;
            return `Raw mode ${this.rawMode ? 'enabled' : 'disabled'}`;
        }
    }

    /**
     * Display help information
     */
    help() {
        return `Available commands:

=== Basic Key-Value Operations ===
SET key value [EX seconds] [PX milliseconds] [EXAT timestamp] [PXAT milliseconds-timestamp] [NX] [XX] [KEEPTTL] [GET]
                             - Set key to hold string value with optional expiration and conditions
GET key                      - Get the value of key
DEL key [key ...]           - Delete one or more keys
EXISTS key [key ...]        - Check if one or more keys exist
KEYS pattern                - Find all keys matching pattern (* for all)
FLUSHALL                    - Remove all keys from all databases
MSET key value [key value...] - Set multiple keys
MGET key [key ...]          - Get multiple keys
GETSET key value            - Get old value and set new value
SETNX key value             - Set key only if it doesn't exist (legacy)
GETRANGE key start end      - Get substring
SETRANGE key offset value   - Set substring
DBSIZE                      - Get number of keys
RANDOMKEY                   - Get random key

=== String Operations ===
APPEND key value             - Append value to key
STRLEN key                   - Get the length of the value stored in key
MSETNX key value [key value...] - Set multiple keys only if none exist
GETDEL key                   - Get key value and delete it atomically
LCS key1 key2 [LEN] [IDX] [MINMATCHLEN len] [WITHMATCHLEN] - Longest Common Subsequence

=== Atomic Operations ===
INCR key                     - Increment the integer value of key by one
DECR key                     - Decrement the integer value of key by one
INCRBY key increment         - Increment the integer value of key by increment
DECRBY key decrement         - Decrement the integer value of key by decrement
INCRBYFLOAT key increment    - Increment the float value of key by increment

=== Key Expiration ===
EXPIRE key seconds           - Set timeout on key in seconds
PEXPIRE key milliseconds     - Set timeout on key in milliseconds
TTL key                      - Get time to live for key in seconds
PTTL key                     - Get time to live for key in milliseconds
PERSIST key                  - Remove timeout from key
EXPIREAT key timestamp       - Set expiration at Unix timestamp
PEXPIREAT key ms-timestamp   - Set expiration at millisecond timestamp
SETEX key seconds value      - Set key with expiration in seconds (legacy)
PSETEX key ms value          - Set key with expiration in milliseconds (legacy)
GETEX key [EX|PX|EXAT|PXAT|PERSIST] - Get value with expiration options

=== Key Management ===
RENAME key newkey            - Rename key to newkey
RENAMENX key newkey          - Rename key only if newkey doesn't exist

=== List Operations ===
LPUSH key element [element...] - Push elements to the left (beginning) of list
RPUSH key element [element...] - Push elements to the right (end) of list
LPOP key                     - Pop element from the left (beginning) of list
RPOP key                     - Pop element from the right (end) of list
LLEN key                     - Get the length of list
LRANGE key start stop        - Get range of elements from list
LINDEX key index             - Get element at index from list
LSET key index element       - Set element at index in list
LTRIM key start stop         - Trim list to specified range
LINSERT key BEFORE|AFTER pivot element - Insert element before or after pivot
LPUSHX key element [element...] - Push to left only if list exists
RPUSHX key element [element...] - Push to right only if list exists
LREM key count element       - Remove elements from list
RPOPLPUSH source dest        - Pop from right of source and push to left of dest
LMOVE source dest LEFT|RIGHT LEFT|RIGHT - Move element between lists (any side to any side)
LPOS key element [RANK rank] [COUNT num] [MAXLEN len] - Find position of element in list
LMPOP numkeys key [key...] LEFT|RIGHT [COUNT count] - Pop elements from multiple lists

=== Blocking List Operations ===
BLPOP key [key...] timeout     - Blocking left pop from lists
BRPOP key [key...] timeout     - Blocking right pop from lists
BRPOPLPUSH source dest timeout - Blocking right pop and left push
BLMOVE source dest LEFT|RIGHT LEFT|RIGHT timeout - Blocking move between lists
BLMPOP timeout numkeys key [key...] LEFT|RIGHT [COUNT count] - Blocking pop from multiple lists

=== Set Operations ===
SADD key member [member...]  - Add members to set
SREM key member [member...]  - Remove members from set
SMEMBERS key                 - Get all members of set
SCARD key                    - Get number of members in set
SISMEMBER key member         - Check if member exists in set
SUNION key [key ...]         - Union of sets
SINTER key [key ...]         - Intersection of sets
SDIFF key [key ...]          - Difference of sets (first set minus others)
SPOP key [count]             - Remove and return random member(s)
SRANDMEMBER key [count]      - Get random member(s) without removing
SMOVE source dest member     - Move member between sets
SUNIONSTORE dest key [key...] - Store union result in destination
SINTERSTORE dest key [key...] - Store intersection result in destination
SDIFFSTORE dest key [key...] - Store difference result in destination
SINTERCARD numkeys key [key...] [LIMIT limit] - Get cardinality of intersection
SMISMEMBER key member [member...] - Check if multiple members exist in set
SSCAN key cursor [MATCH pattern] [COUNT count] - Incrementally iterate set members

=== Hash Operations ===
HSET key field value [field value...] - Set field(s) in hash
HGET key field               - Get field value from hash
HMGET key field [field...]   - Get multiple field values
HGETALL key                  - Get all field-value pairs
HDEL key field [field...]    - Delete field(s) from hash
HEXISTS key field            - Check if field exists in hash
HKEYS key                    - Get all field names
HVALS key                    - Get all values
HLEN key                     - Get number of fields in hash
HINCRBY key field increment  - Increment field by integer
HINCRBYFLOAT key field increment - Increment field by float
HSETNX key field value       - Set field only if it doesn't exist
HMSET key field value [field value...] - Set multiple fields (legacy)
HSTRLEN key field            - Get length of field value
HSCAN key cursor [MATCH pattern] [COUNT count] - Incrementally iterate hash fields
HRANDFIELD key [count [WITHVALUES]] - Get random field(s) from hash

=== Hash Field Expiration (Redis 7.2+) ===
HGETDEL key field            - Get field value and delete it atomically
HEXPIRE key seconds field [field...] - Set field expiration in seconds
HEXPIREAT key timestamp field [field...] - Set field expiration at Unix timestamp
HEXPIRETIME key field [field...] - Get field expiration timestamp
HPEXPIRE key ms field [field...] - Set field expiration in milliseconds
HPEXPIREAT key ms-timestamp field [field...] - Set field expiration at millisecond timestamp
HPEXPIRETIME key field [field...] - Get field expiration timestamp in milliseconds
HTTL key field [field...]    - Get field time to live in seconds
HPTTL key field [field...]   - Get field time to live in milliseconds
HPERSIST key field [field...] - Remove field expiration

=== Sorted Set Operations ===
ZADD key score member [score member...] - Add members with scores to sorted set
ZREM key member [member...]  - Remove members from sorted set
ZSCORE key member            - Get score of member
ZRANK key member             - Get rank (0-based index) of member
ZREVRANK key member          - Get reverse rank of member
ZRANGE key start stop [WITHSCORES] - Get range of members by rank
ZREVRANGE key start stop [WITHSCORES] - Get range of members by rank (reverse)
ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count] - Get range by score
ZREVRANGEBYSCORE key max min [WITHSCORES] [LIMIT offset count] - Get range by score (reverse)
ZRANGEBYLEX key min max [LIMIT offset count] - Get range by lexicographical order
ZREVRANGEBYLEX key max min [LIMIT offset count] - Get range by lexicographical order (reverse)
ZCOUNT key min max           - Count members in score range
ZLEXCOUNT key min max        - Count members in lexicographical range
ZCARD key                    - Get number of members in sorted set
ZINCRBY key increment member - Increment score of member
ZREMRANGEBYRANK key start stop - Remove members by rank range
ZREMRANGEBYSCORE key min max - Remove members by score range
ZREMRANGEBYLEX key min max   - Remove members by lexicographical range

=== Advanced Sorted Set Operations ===
ZPOPMIN key [count]          - Pop minimum scored members
ZPOPMAX key [count]          - Pop maximum scored members  
ZMSCORE key member [member...] - Get scores for multiple members
ZRANDMEMBER key [count [WITHSCORES]] - Get random member(s) from sorted set
ZSCAN key cursor [MATCH pattern] [COUNT count] - Incrementally iterate sorted set
ZUNION numkeys key [key...]  - Union of multiple sorted sets (without storing)
ZUNIONSTORE dest numkeys key [key...] - Store union of multiple sorted sets
ZINTER numkeys key [key...]  - Intersection of multiple sorted sets (without storing)
ZINTERSTORE dest numkeys key [key...] - Store intersection of multiple sorted sets
ZDIFF numkeys key [key...]   - Difference of multiple sorted sets (without storing)
ZDIFFSTORE dest numkeys key [key...] - Store difference of multiple sorted sets
ZINTERCARD numkeys key [key...] [LIMIT limit] - Get cardinality of intersection
ZMPOP numkeys key [key...] MIN|MAX [COUNT count] - Pop members from multiple sorted sets
ZRANGESTORE dest source start stop - Store range results in destination key

=== Blocking Sorted Set Operations ===
BZPOPMIN key [key...] timeout - Blocking pop minimum scored members
BZPOPMAX key [key...] timeout - Blocking pop maximum scored members
BZMPOP timeout numkeys key [key...] MIN|MAX [COUNT count] - Blocking pop from multiple sorted sets

=== JSON Operations ===
JSON.GET key [path] [INDENT] [NEWLINE] [SPACE] - Get JSON value at path
JSON.SET key path value [NX|XX] - Set JSON value at path
JSON.DEL key [path]          - Delete JSON value at path
JSON.TYPE key [path]         - Get JSON type at path
JSON.STRLEN key [path]       - Get string length at path
JSON.MGET key [key...] path  - Get JSON values from multiple keys at path

=== JSON Array Operations ===
JSON.ARRAPPEND key path value [value...] - Append values to JSON array
JSON.ARRLEN key [path]       - Get JSON array length
JSON.ARRINDEX key path value [start [stop]] - Find index of value in array
JSON.ARRINSERT key path index value [value...] - Insert values into array
JSON.ARRPOP key path [index] - Pop value from JSON array
JSON.ARRTRIM key path start stop - Trim JSON array to range

=== JSON Object Operations ===
JSON.OBJKEYS key [path]      - Get JSON object keys
JSON.OBJLEN key [path]       - Get JSON object length

=== JSON Numeric Operations ===
JSON.NUMINCRBY key path value - Increment number at JSON path
JSON.NUMMULTBY key path value - Multiply number at JSON path

=== JSON Utility Operations ===
JSON.CLEAR key [path]        - Clear JSON value at path  
JSON.FORGET key [path]       - Alias for JSON.DEL
JSON.RESP key [path]         - Get JSON value in RESP format
JSON.DEBUG subcommand [key] [path] - Debug JSON operations
JSON.MSET key path value [key path value ...] - Set multiple JSON keys
JSON.MERGE key path value    - Merge JSON value into existing paths
JSON.STRAPPEND key path value - Append to string at JSON path
JSON.TOGGLE key path         - Toggle boolean value at JSON path

=== Transaction Support ===
MULTI                       - Start a transaction
EXEC                        - Execute all commands in the transaction
DISCARD                     - Discard the transaction
WATCH key [key ...]         - Watch keys for changes (optimistic locking)
UNWATCH                     - Stop watching all keys

=== System ===
TYPE key                     - Get the type of key (string, list, set, hash, zset, json, none)
RAW [on|off]                - Toggle raw output mode for JSON formatting
BGREWRITEAOF                - Rewrite AOF file in background for compaction
SAVE                        - Save dataset to RDB snapshot synchronously
BGSAVE                      - Save dataset to RDB snapshot in background
LASTSAVE                    - Get timestamp of last successful RDB save

=== Geospatial Commands ===
GEOADD key longitude latitude member [longitude latitude member ...]  - Add geospatial items
GEODIST key member1 member2 [unit]  - Get distance between members
GEOPOS key member [member ...]      - Get positions of members
GEOHASH key member [member ...]     - Get geohash strings for members
GEORADIUS key longitude latitude radius unit [options]  - Search within radius from coordinates
GEORADIUSBYMEMBER key member radius unit [options]      - Search within radius from member
GEOSEARCH key FROMMEMBER member|FROMLONLAT lon lat BY radius unit|BYBOX width height unit [options]  - Modern geo search
GEOSEARCHSTORE dest src FROMMEMBER member|FROMLONLAT lon lat BY radius unit|BYBOX width height unit [options]  - Store geo search results

=== Bitmap Commands ===
SETBIT key offset value      - Set bit at offset to value (0 or 1)
GETBIT key offset            - Get bit value at offset
BITCOUNT key [start end]     - Count set bits in range
BITPOS key bit [start [end]] - Find first bit set to value
BITOP operation destkey key [key ...]  - Perform bitwise operation (AND, OR, XOR, NOT)
BITFIELD key [GET type offset] [SET type offset value] [INCRBY type offset increment] [OVERFLOW WRAP|SAT|FAIL]  - Bitfield operations
BITFIELD_RO key [GET type offset] [GET type offset ...]  - Read-only bitfield operations

=== Stream Commands ===
XADD key id field value [field value ...]  - Add entry to stream
XREAD [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]  - Read entries from streams
XRANGE key start end [COUNT count]       - Get range of entries from stream
XREVRANGE key end start [COUNT count]    - Get reverse range of entries from stream
XLEN key                     - Get number of entries in stream
XTRIM key MAXLEN|MINID [~] count|id      - Trim stream to maximum length or minimum ID
XDEL key id [id ...]         - Delete entries from stream
XSETID key id                - Set stream last generated ID
XGROUP CREATE key groupname id  - Create consumer group
XGROUP DESTROY key groupname    - Destroy consumer group
XGROUP SETID key groupname id   - Set consumer group last delivered ID
XGROUP CREATECONSUMER key groupname consumername  - Create consumer in group
XGROUP DELCONSUMER key groupname consumername  - Delete consumer from group
XREADGROUP GROUP group consumer [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]  - Read from stream as consumer group
XACK key group id [id ...]   - Acknowledge processed entries
XPENDING key group [start end count] [consumer]  - Get pending entries info
XCLAIM key group consumer min-idle-time id [id ...] [options]  - Claim pending entries
XAUTOCLAIM key group consumer min-idle-time start [COUNT count] [JUSTID]  - Auto-claim pending entries
XINFO STREAM key             - Get stream information
XINFO GROUPS key             - Get consumer groups information
XINFO CONSUMERS key group    - Get consumers information

HELP                        - Show this help message
QUIT/EXIT                   - Exit the server`;
    }

    /**
     * SET key value [EX seconds] [PX milliseconds] [EXAT timestamp] [PXAT milliseconds-timestamp] [NX] [XX] [KEEPTTL] [GET]
     * Set key to hold string value with optional expiration and conditions
     * @param {Array<string>} args - Command arguments
     */
    set(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'set' command");
        }

        const [key, value] = args;
        const options = args.slice(2);

        // Parse options
        let expirationMs = null;
        let onlyIfExists = false;     // XX option
        let onlyIfNotExists = false;  // NX option
        let keepTtl = false;          // KEEPTTL option
        let returnOldValue = false;   // GET option

        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            
            switch (option) {
                case 'EX':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const seconds = parseInt(options[i + 1], 10);
                    if (isNaN(seconds) || seconds <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = seconds * 1000;
                    i++; // Skip next argument
                    break;
                    
                case 'PX':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const milliseconds = parseInt(options[i + 1], 10);
                    if (isNaN(milliseconds) || milliseconds <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = milliseconds;
                    i++; // Skip next argument
                    break;
                    
                case 'EXAT':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const timestamp = parseInt(options[i + 1], 10);
                    if (isNaN(timestamp) || timestamp <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = (timestamp * 1000) - Date.now();
                    if (expirationMs <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    i++; // Skip next argument
                    break;
                    
                case 'PXAT':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const timestampMs = parseInt(options[i + 1], 10);
                    if (isNaN(timestampMs) || timestampMs <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = timestampMs - Date.now();
                    if (expirationMs <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    i++; // Skip next argument
                    break;
                    
                case 'NX':
                    onlyIfNotExists = true;
                    break;
                    
                case 'XX':
                    onlyIfExists = true;
                    break;
                    
                case 'KEEPTTL':
                    keepTtl = true;
                    break;
                    
                case 'GET':
                    returnOldValue = true;
                    break;
                    
                default:
                    throw new Error("ERR syntax error");
            }
        }

        // Check conflicting options
        if (onlyIfExists && onlyIfNotExists) {
            throw new Error("ERR syntax error");
        }
        
        if (keepTtl && expirationMs !== null) {
            throw new Error("ERR syntax error");
        }

        // Get current value for return (if GET option is used)
        const currentValue = this.getValue(key);
        const keyExists = currentValue !== undefined;

        // Check conditions
        if (onlyIfNotExists && keyExists) {
            return returnOldValue ? (currentValue ? `"${currentValue}"` : '(nil)') : '(nil)';
        }
        
        if (onlyIfExists && !keyExists) {
            return returnOldValue ? '(nil)' : '(nil)';
        }

        // Store old value for return
        const oldValue = returnOldValue ? (currentValue || null) : null;

        // Set the value
        this.setValue(key, value, 'string');

        // Handle expiration
        if (keepTtl && keyExists && this.expiration.has(key)) {
            // Keep existing TTL - do nothing with expiration
        } else if (expirationMs !== null) {
            // Set new expiration
            const expireTime = Date.now() + expirationMs;
            this.expiration.set(key, expireTime);
        } else {
            // Remove any existing expiration if no expiration specified
            this.expiration.delete(key);
        }

        // Return appropriate response
        if (returnOldValue) {
            return oldValue ? `"${oldValue}"` : '(nil)';
        }
        
        return 'OK';
    }

    /**
     * GET key - Get the value of key
     * @param {Array<string>} args - Command arguments
     */
    get(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'get' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        if (value === undefined) {
            return '(nil)';
        }

        // Check if it's a string
        if (this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }
        
        return `"${value}"`;
    }

    /**
     * DEL key [key ...] - Delete one or more keys
     * @param {Array<string>} args - Command arguments
     */
    del(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'del' command");
        }

        let deletedCount = 0;
        for (const key of args) {
            if (this.getValue(key) !== undefined) {
                this.deleteKey(key);
                deletedCount++;
            }
        }

        return `(integer) ${deletedCount}`;
    }

    /**
     * EXISTS key [key ...] - Check if one or more keys exist
     * @param {Array<string>} args - Command arguments
     */
    exists(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'exists' command");
        }

        let existCount = 0;
        for (const key of args) {
            // Check if key exists and is not expired
            if (this.getValue(key) !== undefined) {
                existCount++;
            }
        }

        return `(integer) ${existCount}`;
    }

    /**
     * KEYS pattern - Find all keys matching pattern
     * @param {Array<string>} args - Command arguments
     */
    keys(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'keys' command");
        }

        const pattern = args[0];
        const allKeys = Array.from(this.data.keys());
        
        if (pattern === '*') {
            // Return all keys
            if (allKeys.length === 0) {
                return '(empty list or set)';
            }
            return allKeys.map((key, index) => `${index + 1}) "${key}"`).join('\n');
        }

        // Convert Redis pattern to JavaScript regex
        const regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        
        const regex = new RegExp(`^${regexPattern}$`);
        const matchingKeys = allKeys.filter(key => regex.test(key));
        
        if (matchingKeys.length === 0) {
            return '(empty list or set)';
        }
        
        return matchingKeys.map((key, index) => `${index + 1}) "${key}"`).join('\n');
    }

    /**
     * FLUSHALL - Remove all keys from all databases
     */
    flushall() {
        this.data.clear();
        this.types.clear();
        this.expiration.clear();
        return 'OK';
    }

    /**
     * Get current database size
     */
    dbsize(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'dbsize' command");
        }
        return `(integer) ${this.data.size}`;
    }

    /**
     * MSET key value [key value ...] - Set multiple keys
     * @param {Array<string>} args - Command arguments
     */
    mset(args) {
        if (args.length === 0 || args.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for 'mset' command");
        }

        for (let i = 0; i < args.length; i += 2) {
            const key = args[i];
            const value = args[i + 1];
            this.setValue(key, value, 'string');
        }

        return 'OK';
    }

    /**
     * MGET key [key ...] - Get multiple keys
     * @param {Array<string>} args - Command arguments
     */
    mget(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'mget' command");
        }

        const results = [];
        for (const key of args) {
            const value = this.getValue(key);
            if (value === undefined || this.getType(key) !== 'string') {
                results.push('(nil)');
            } else {
                results.push(`"${value}"`);
            }
        }

        return results.map((result, index) => `${index + 1}) ${result}`).join('\n');
    }

    /**
     * GETSET key value - Get old value and set new value
     * @param {Array<string>} args - Command arguments
     */
    getset(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'getset' command");
        }

        const [key, value] = args;
        const oldValue = this.getValue(key);
        
        // Check if it's a string or doesn't exist
        if (oldValue !== undefined && this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        this.setValue(key, value, 'string');
        
        return oldValue === undefined ? '(nil)' : `"${oldValue}"`;
    }

    /**
     * SETNX key value - Set key only if it doesn't exist
     * @param {Array<string>} args - Command arguments
     */
    setnx(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'setnx' command");
        }

        const [key, value] = args;
        
        if (this.getValue(key) !== undefined) {
            return '(integer) 0';
        }

        this.setValue(key, value, 'string');
        return '(integer) 1';
    }

    /**
     * GETRANGE/SUBSTR key start end - Get substring
     * @param {Array<string>} args - Command arguments
     */
    getrange(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'getrange' command");
        }

        const [key, startStr, endStr] = args;
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);

        if (isNaN(start) || isNaN(end)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const value = this.getValue(key);
        
        if (value === undefined) {
            return '""';
        }

        if (this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const str = value.toString();
        const len = str.length;
        
        // Handle negative indices
        let actualStart = start < 0 ? len + start : start;
        let actualEnd = end < 0 ? len + end : end;
        
        // Clamp to valid range
        actualStart = Math.max(0, actualStart);
        actualEnd = Math.min(len - 1, actualEnd);
        
        if (actualStart > actualEnd || actualStart >= len) {
            return '""';
        }

        const result = str.substring(actualStart, actualEnd + 1);
        return `"${result}"`;
    }

    /**
     * SETRANGE key offset value - Set substring
     * @param {Array<string>} args - Command arguments
     */
    setrange(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'setrange' command");
        }

        const [key, offsetStr, value] = args;
        const offset = parseInt(offsetStr, 10);

        if (isNaN(offset) || offset < 0) {
            throw new Error("ERR offset is out of range");
        }

        let existingValue = this.getValue(key) || '';
        
        // Check if it's a string or doesn't exist
        if (this.getValue(key) !== undefined && this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Extend string with null bytes if needed
        while (existingValue.length < offset) {
            existingValue += '\x00';
        }

        // Replace substring
        const before = existingValue.substring(0, offset);
        const after = existingValue.substring(offset + value.length);
        const newValue = before + value + after;

        this.setValue(key, newValue, 'string');
        return `(integer) ${newValue.length}`;
    }

    /**
     * RANDOMKEY - Get a random key
     * @param {Array<string>} args - Command arguments
     */
    randomkey(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'randomkey' command");
        }

        const keys = Array.from(this.data.keys());
        const validKeys = keys.filter(key => this.getValue(key) !== undefined);
        
        if (validKeys.length === 0) {
            return '(nil)';
        }

        const randomKey = validKeys[Math.floor(Math.random() * validKeys.length)];
        return `"${randomKey}"`;
    }

    // ===== PHASE 2 COMMANDS =====

    /**
     * APPEND key value - Append value to key
     * @param {Array<string>} args - Command arguments
     */
    append(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'append' command");
        }

        const [key, value] = args;
        const existingValue = this.getValue(key);
        
        // Check if key exists and is a string
        if (existingValue !== undefined && this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        if (existingValue === undefined) {
            // Key doesn't exist, create it with the value
            this.setValue(key, value, 'string');
            return `(integer) ${value.length}`;
        } else {
            // Key exists, append to existing value
            const newValue = existingValue + value;
            this.setValue(key, newValue, 'string');
            return `(integer) ${newValue.length}`;
        }
    }

    /**
     * STRLEN key - Get the length of the value stored in key
     * @param {Array<string>} args - Command arguments
     */
    strlen(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'strlen' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        if (value === undefined) {
            return '(integer) 0';
        }

        // Check if it's a string
        if (this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }
        
        return `(integer) ${value.length}`;
    }

    /**
     * INCR key - Increment the integer value of key by one
     * @param {Array<string>} args - Command arguments
     */
    incr(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'incr' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue + 1;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * DECR key - Decrement the integer value of key by one
     * @param {Array<string>} args - Command arguments
     */
    decr(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'decr' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue - 1;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * INCRBY key increment - Increment the integer value of key by increment
     * @param {Array<string>} args - Command arguments
     */
    incrby(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'incrby' command");
        }

        const [key, incrementStr] = args;
        const increment = parseInt(incrementStr, 10);
        
        if (isNaN(increment)) {
            throw new Error("ERR value is not an integer or out of range");
        }
        
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue + increment;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * DECRBY key decrement - Decrement the integer value of key by decrement
     * @param {Array<string>} args - Command arguments
     */
    decrby(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'decrby' command");
        }

        const [key, decrementStr] = args;
        const decrement = parseInt(decrementStr, 10);
        
        if (isNaN(decrement)) {
            throw new Error("ERR value is not an integer or out of range");
        }
        
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue - decrement;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * INCRBYFLOAT key increment - Increment key by floating point number
     * @param {Array<string>} args - Command arguments
     */
    incrbyfloat(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'incrbyfloat' command");
        }

        const [key, incrementStr] = args;
        const increment = parseFloat(incrementStr);
        
        if (isNaN(increment) || !isFinite(increment)) {
            throw new Error("ERR value is not a valid float");
        }
        
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseFloat(value);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not a valid float");
            }
        }
        
        const newValue = numValue + increment;
        
        if (!isFinite(newValue)) {
            throw new Error("ERR increment or decrement would overflow");
        }
        
        this.setValue(key, newValue.toString());
        return `"${newValue}"`;
    }

    /**
     * MSETNX key value [key value ...] - Set multiple keys only if none exist
     * @param {Array<string>} args - Command arguments
     */
    msetnx(args) {
        if (args.length === 0 || args.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for 'msetnx' command");
        }

        const keyValuePairs = [];
        for (let i = 0; i < args.length; i += 2) {
            keyValuePairs.push([args[i], args[i + 1]]);
        }

        // Check if any key exists
        for (const [key] of keyValuePairs) {
            if (this.getValue(key) !== undefined) {
                return '(integer) 0';
            }
        }

        // Set all keys if none exist
        for (const [key, value] of keyValuePairs) {
            this.setValue(key, value);
        }

        return '(integer) 1';
    }

    /**
     * GETDEL key - Get key value and delete it atomically
     * @param {Array<string>} args - Command arguments
     */
    getdel(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'getdel' command");
        }

        const [key] = args;
        const value = this.getValue(key);

        if (value === undefined) {
            return '(nil)';
        }

        // Check if it's a string type
        if (this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Delete the key
        this.deleteKey(key);

        return `"${value}"`;
    }

    /**
     * LCS key1 key2 [LEN] [IDX] [MINMATCHLEN minmatchlen] [WITHMATCHLEN] - Longest Common Subsequence
     * @param {Array<string>} args - Command arguments
     */
    lcs(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'lcs' command");
        }

        const [key1, key2, ...options] = args;
        
        const value1 = this.getValue(key1);
        const value2 = this.getValue(key2);

        const str1 = value1 !== undefined ? value1 : '';
        const str2 = value2 !== undefined ? value2 : '';

        // Parse options
        let returnLength = false;
        let returnIndices = false;
        let minMatchLen = 0;
        let withMatchLen = false;

        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            switch (option) {
                case 'LEN':
                    returnLength = true;
                    break;
                case 'IDX':
                    returnIndices = true;
                    break;
                case 'MINMATCHLEN':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    minMatchLen = parseInt(options[i + 1], 10);
                    if (isNaN(minMatchLen) || minMatchLen < 0) {
                        throw new Error("ERR MINMATCHLEN should be >= 0");
                    }
                    i++; // Skip next argument
                    break;
                case 'WITHMATCHLEN':
                    withMatchLen = true;
                    break;
                default:
                    throw new Error("ERR syntax error");
            }
        }

        // Calculate LCS using dynamic programming
        const lcs = this._calculateLCS(str1, str2, minMatchLen);

        if (returnLength) {
            return `(integer) ${lcs.length}`;
        }

        if (returnIndices) {
            const matches = this._getLCSMatches(str1, str2, lcs, minMatchLen);
            let response = `1) "matches"\n2) `;
            if (matches.length === 0) {
                response += '(empty list or set)';
            } else {
                response += matches.map((match, index) => {
                    let matchStr = `${index + 1}) `;
                    matchStr += `1) 1) (integer) ${match.s1Start}\n     2) (integer) ${match.s1End}\n`;
                    matchStr += `   2) 1) (integer) ${match.s2Start}\n     2) (integer) ${match.s2End}`;
                    if (withMatchLen) {
                        matchStr += `\n   3) (integer) ${match.length}`;
                    }
                    return matchStr;
                }).join('\n   ');
            }
            response += `\n3) "len"\n4) (integer) ${lcs.length}`;
            return response;
        }

        return `"${lcs}"`;
    }

    /**
     * Calculate Longest Common Subsequence using dynamic programming
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @param {number} minMatchLen - Minimum match length
     * @returns {string} - LCS string
     * @private
     */
    _calculateLCS(str1, str2, minMatchLen = 0) {
        if (!str1 || !str2) return '';

        const m = str1.length;
        const n = str2.length;
        
        // Create DP table
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        // Fill DP table
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        
        // Reconstruct LCS
        let lcs = '';
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (str1[i - 1] === str2[j - 1]) {
                lcs = str1[i - 1] + lcs;
                i--;
                j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        
        return lcs;
    }

    /**
     * Get LCS matches with positions
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @param {string} lcs - LCS string
     * @param {number} minMatchLen - Minimum match length
     * @returns {Array} - Array of match objects
     * @private
     */
    _getLCSMatches(str1, str2, lcs, minMatchLen = 0) {
        // Simplified implementation - returns basic match info
        const matches = [];
        
        if (lcs.length >= minMatchLen && lcs.length > 0) {
            // Find first occurrence of LCS in both strings
            const s1Index = str1.indexOf(lcs);
            const s2Index = str2.indexOf(lcs);
            
            if (s1Index !== -1 && s2Index !== -1) {
                matches.push({
                    s1Start: s1Index,
                    s1End: s1Index + lcs.length - 1,
                    s2Start: s2Index,
                    s2End: s2Index + lcs.length - 1,
                    length: lcs.length
                });
            }
        }
        
        return matches;
    }

    /**
     * EXPIRE key seconds - Set timeout on key in seconds
     * @param {Array<string>} args - Command arguments
     */
    expire(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'expire' command");
        }

        const [key, secondsStr] = args;
        const seconds = parseInt(secondsStr, 10);
        
        if (isNaN(seconds) || seconds < 0) {
            throw new Error("ERR invalid expire time in 'expire' command");
        }
        
        // Check if key exists (and is not expired)
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Set expiration time
        const expireTime = Date.now() + (seconds * 1000);
        this.expiration.set(key, expireTime);
        
        return '(integer) 1';
    }

    /**
     * TTL key - Get time to live for key in seconds
     * @param {Array<string>} args - Command arguments
     */
    ttl(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'ttl' command");
        }

        const key = args[0];
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) -2';  // Key does not exist
        }
        
        // Check if key has expiration
        if (!this.expiration.has(key)) {
            return '(integer) -1';  // Key exists but has no expiration
        }
        
        const expireTime = this.expiration.get(key);
        const now = Date.now();
        const ttlMs = expireTime - now;
        
        if (ttlMs <= 0) {
            // Key has expired
            this.data.delete(key);
            this.expiration.delete(key);
            return '(integer) -2';
        }
        
        const ttlSeconds = Math.ceil(ttlMs / 1000);
        return `(integer) ${ttlSeconds}`;
    }

    /**
     * PEXPIRE key milliseconds - Set timeout on key in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    pexpire(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'pexpire' command");
        }

        const [key, millisecondsStr] = args;
        const milliseconds = parseInt(millisecondsStr, 10);
        
        if (isNaN(milliseconds) || milliseconds < 0) {
            throw new Error("ERR invalid expire time in 'pexpire' command");
        }
        
        // Check if key exists (and is not expired)
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Set expiration time
        const expireTime = Date.now() + milliseconds;
        this.expiration.set(key, expireTime);
        
        return '(integer) 1';
    }

    /**
     * PTTL key - Get time to live for key in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    pttl(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'pttl' command");
        }

        const key = args[0];
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) -2';  // Key does not exist
        }
        
        // Check if key has expiration
        if (!this.expiration.has(key)) {
            return '(integer) -1';  // Key exists but has no expiration
        }
        
        const expireTime = this.expiration.get(key);
        const now = Date.now();
        const ttlMs = expireTime - now;
        
        if (ttlMs <= 0) {
            // Key has expired
            this.data.delete(key);
            this.expiration.delete(key);
            return '(integer) -2';
        }
        
        return `(integer) ${Math.ceil(ttlMs)}`;
    }

    /**
     * PERSIST key - Remove timeout from key
     * @param {Array<string>} args - Command arguments
     */
    persist(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'persist' command");
        }

        const key = args[0];
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Check if key has expiration
        if (!this.expiration.has(key)) {
            return '(integer) 0';  // Key has no timeout
        }
        
        // Remove expiration
        this.expiration.delete(key);
        return '(integer) 1';
    }

    /**
     * RENAME key newkey - Rename key to newkey
     * @param {Array<string>} args - Command arguments
     */
    rename(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'rename' command");
        }

        const [oldKey, newKey] = args;
        
        // Check if source key exists
        const value = this.getValue(oldKey);
        if (value === undefined) {
            throw new Error("ERR no such key");
        }
        
        // Copy value to new key
        this.setValue(newKey, value, this.getType(oldKey));
        
        // Copy expiration if it exists
        if (this.expiration.has(oldKey)) {
            const expireTime = this.expiration.get(oldKey);
            this.expiration.set(newKey, expireTime);
        }
        
        // Delete old key
        this.deleteKey(oldKey);
        
        return 'OK';
    }

    /**
     * RENAMENX key newkey - Rename key only if newkey doesn't exist
     * @param {Array<string>} args - Command arguments
     */
    renamenx(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'renamenx' command");
        }

        const [oldKey, newKey] = args;
        
        // Check if source key exists
        const value = this.getValue(oldKey);
        if (value === undefined) {
            throw new Error("ERR no such key");
        }

        // Check if destination key exists
        if (this.getValue(newKey) !== undefined) {
            return '(integer) 0';
        }

        // Perform rename
        this.setValue(newKey, value, this.getType(oldKey));
        
        // Copy expiration if it exists
        if (this.expiration.has(oldKey)) {
            const expireTime = this.expiration.get(oldKey);
            this.expiration.set(newKey, expireTime);
        }
        
        // Delete old key
        this.deleteKey(oldKey);
        
        return '(integer) 1';
    }

    /**
     * EXPIREAT key timestamp - Set expiration at Unix timestamp
     * @param {Array<string>} args - Command arguments
     */
    expireat(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'expireat' command");
        }

        const [key, timestampStr] = args;
        const timestamp = parseInt(timestampStr, 10);
        
        if (isNaN(timestamp) || timestamp < 0) {
            throw new Error("ERR invalid expire time in 'expireat' command");
        }
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Set expiration time
        const expireTime = timestamp * 1000; // Convert to milliseconds
        this.expiration.set(key, expireTime);
        
        return '(integer) 1';
    }

    /**
     * PEXPIREAT key milliseconds-timestamp - Set expiration at millisecond timestamp
     * @param {Array<string>} args - Command arguments
     */
    pexpireat(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'pexpireat' command");
        }

        const [key, timestampStr] = args;
        const timestamp = parseInt(timestampStr, 10);
        
        if (isNaN(timestamp) || timestamp < 0) {
            throw new Error("ERR invalid expire time in 'pexpireat' command");
        }
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Set expiration time
        this.expiration.set(key, timestamp);
        
        return '(integer) 1';
    }

    /**
     * SETEX key seconds value - Set key with expiration in seconds
     * @param {Array<string>} args - Command arguments
     */
    setex(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'setex' command");
        }

        const [key, secondsStr, value] = args;
        const seconds = parseInt(secondsStr, 10);
        
        if (isNaN(seconds) || seconds <= 0) {
            throw new Error("ERR invalid expire time in 'setex' command");
        }
        
        // Set the value
        this.setValue(key, value, 'string');
        
        // Set expiration
        const expireTime = Date.now() + (seconds * 1000);
        this.expiration.set(key, expireTime);
        
        return 'OK';
    }

    /**
     * PSETEX key milliseconds value - Set key with expiration in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    psetex(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'psetex' command");
        }

        const [key, millisecondsStr, value] = args;
        const milliseconds = parseInt(millisecondsStr, 10);
        
        if (isNaN(milliseconds) || milliseconds <= 0) {
            throw new Error("ERR invalid expire time in 'psetex' command");
        }
        
        // Set the value
        this.setValue(key, value, 'string');
        
        // Set expiration
        const expireTime = Date.now() + milliseconds;
        this.expiration.set(key, expireTime);
        
        return 'OK';
    }

    /**
     * GETEX key [EX seconds] [PX milliseconds] [EXAT timestamp] [PXAT milliseconds-timestamp] [PERSIST] - Get value with expiration options
     * @param {Array<string>} args - Command arguments
     */
    getex(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'getex' command");
        }

        const [key, ...options] = args;
        const value = this.getValue(key);
        
        if (value === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Parse expiration options
        let expirationMs = null;
        let persist = false;

        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            
            switch (option) {
                case 'EX':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const seconds = parseInt(options[i + 1], 10);
                    if (isNaN(seconds) || seconds <= 0) {
                        throw new Error("ERR invalid expire time");
                    }
                    expirationMs = seconds * 1000;
                    i++; // Skip next argument
                    break;
                    
                case 'PX':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const milliseconds = parseInt(options[i + 1], 10);
                    if (isNaN(milliseconds) || milliseconds <= 0) {
                        throw new Error("ERR invalid expire time");
                    }
                    expirationMs = milliseconds;
                    i++; // Skip next argument
                    break;
                    
                case 'EXAT':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const timestamp = parseInt(options[i + 1], 10);
                    if (isNaN(timestamp) || timestamp <= 0) {
                        throw new Error("ERR invalid expire time");
                    }
                    expirationMs = (timestamp * 1000) - Date.now();
                    if (expirationMs <= 0) {
                        throw new Error("ERR invalid expire time");
                    }
                    i++; // Skip next argument
                    break;
                    
                case 'PXAT':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const timestampMs = parseInt(options[i + 1], 10);
                    if (isNaN(timestampMs) || timestampMs <= 0) {
                        throw new Error("ERR invalid expire time");
                    }
                    expirationMs = timestampMs - Date.now();
                    if (expirationMs <= 0) {
                        throw new Error("ERR invalid expire time");
                    }
                    i++; // Skip next argument
                    break;
                    
                case 'PERSIST':
                    persist = true;
                    break;
                    
                default:
                    throw new Error("ERR syntax error");
            }
        }

        // Apply expiration changes
        if (persist) {
            this.expiration.delete(key);
        } else if (expirationMs !== null) {
            const expireTime = Date.now() + expirationMs;
            this.expiration.set(key, expireTime);
        }

        return `"${value}"`;
    }

    // ===== PHASE 3 COMMANDS - LIST OPERATIONS =====

    /**
     * LPUSH key element [element ...] - Push elements to the left (beginning) of the list
     * @param {Array<string>} args - Command arguments
     */
    lpush(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'lpush' command");
        }

        const [key, ...elements] = args;
        
        // Check if key exists and ensure it's a list or doesn't exist
        if (!this.checkType(key, 'list')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let list = this.getValue(key);
        if (list === undefined) {
            list = new RedisList();
            this.setValue(key, list, 'list');
        }

        const newLength = list.lpush(...elements);
        return `(integer) ${newLength}`;
    }

    /**
     * RPUSH key element [element ...] - Push elements to the right (end) of the list
     * @param {Array<string>} args - Command arguments
     */
    rpush(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'rpush' command");
        }

        const [key, ...elements] = args;
        
        // Check if key exists and ensure it's a list or doesn't exist
        if (!this.checkType(key, 'list')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let list = this.getValue(key);
        if (list === undefined) {
            list = new RedisList();
            this.setValue(key, list, 'list');
        }

        const newLength = list.rpush(...elements);
        return `(integer) ${newLength}`;
    }

    /**
     * LPOP key - Pop element from the left (beginning) of the list
     * @param {Array<string>} args - Command arguments
     */
    lpop(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'lpop' command");
        }

        const key = args[0];
        const list = this.getValue(key);

        if (list === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const element = list.lpop();
        
        // If list becomes empty, remove the key
        if (list.length() === 0) {
            this.deleteKey(key);
        }

        return element === undefined ? '(nil)' : `"${element}"`;
    }

    /**
     * RPOP key - Pop element from the right (end) of the list
     * @param {Array<string>} args - Command arguments
     */
    rpop(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'rpop' command");
        }

        const key = args[0];
        const list = this.getValue(key);

        if (list === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const element = list.rpop();
        
        // If list becomes empty, remove the key
        if (list.length() === 0) {
            this.deleteKey(key);
        }

        return element === undefined ? '(nil)' : `"${element}"`;
    }

    /**
     * LLEN key - Get the length of the list
     * @param {Array<string>} args - Command arguments
     */
    llen(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'llen' command");
        }

        const key = args[0];
        const list = this.getValue(key);

        if (list === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${list.length()}`;
    }

    /**
     * LRANGE key start stop - Get range of elements from list
     * @param {Array<string>} args - Command arguments
     */
    lrange(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'lrange' command");
        }

        const [key, startStr, stopStr] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const elements = list.range(start, stop);
        
        if (elements.length === 0) {
            return '(empty list or set)';
        }

        return elements.map((element, index) => `${index + 1}) "${element}"`).join('\n');
    }

    /**
     * LINDEX key index - Get element at index from list
     * @param {Array<string>} args - Command arguments
     */
    lindex(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'lindex' command");
        }

        const [key, indexStr] = args;
        const index = parseInt(indexStr, 10);

        if (isNaN(index)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const element = list.index(index);
        return element === undefined ? '(nil)' : `"${element}"`;
    }

    /**
     * LSET key index element - Set element at index in list
     * @param {Array<string>} args - Command arguments
     */
    lset(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'lset' command");
        }

        const [key, indexStr, element] = args;
        const index = parseInt(indexStr, 10);

        if (isNaN(index)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const success = list.set(index, element);
        if (!success) {
            throw new Error("ERR index out of range");
        }

        return 'OK';
    }

    /**
     * LTRIM key start stop - Trim list to specified range
     * @param {Array<string>} args - Command arguments
     */
    ltrim(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'ltrim' command");
        }

        const [key, startStr, stopStr] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            return 'OK'; // Redis behavior: LTRIM on non-existent key is OK
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        list.trim(start, stop);

        // If list becomes empty, remove the key
        if (list.length() === 0) {
            this.deleteKey(key);
        }

        return 'OK';
    }

    /**
     * LINSERT key BEFORE|AFTER pivot element - Insert element before or after pivot
     * @param {Array<string>} args - Command arguments
     */
    linsert(args) {
        if (args.length !== 4) {
            throw new Error("ERR wrong number of arguments for 'linsert' command");
        }

        const [key, direction, pivot, element] = args;
        const list = this.getValue(key);

        if (list === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const dir = direction.toUpperCase();
        if (dir !== 'BEFORE' && dir !== 'AFTER') {
            throw new Error("ERR syntax error");
        }

        // Find pivot element
        const pivotIndex = list.elements.findIndex(elem => elem === pivot);
        if (pivotIndex === -1) {
            return '(integer) -1';
        }

        // Insert element
        const insertIndex = dir === 'BEFORE' ? pivotIndex : pivotIndex + 1;
        list.elements.splice(insertIndex, 0, element);

        return `(integer) ${list.elements.length}`;
    }

    /**
     * LPUSHX key element [element ...] - Push to left only if list exists
     * @param {Array<string>} args - Command arguments
     */
    lpushx(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'lpushx' command");
        }

        const [key, ...elements] = args;
        const list = this.getValue(key);

        if (list === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const newLength = list.lpush(...elements);
        return `(integer) ${newLength}`;
    }

    /**
     * RPUSHX key element [element ...] - Push to right only if list exists
     * @param {Array<string>} args - Command arguments
     */
    rpushx(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'rpushx' command");
        }

        const [key, ...elements] = args;
        const list = this.getValue(key);

        if (list === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const newLength = list.rpush(...elements);
        return `(integer) ${newLength}`;
    }

    /**
     * LREM key count element - Remove elements from list
     * @param {Array<string>} args - Command arguments
     */
    lrem(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'lrem' command");
        }

        const [key, countStr, element] = args;
        const count = parseInt(countStr, 10);
        
        if (isNaN(count)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let removedCount = 0;
        let absCount = Math.abs(count);
        
        if (count === 0) {
            // Remove all occurrences
            absCount = Infinity;
        }

        if (count >= 0) {
            // Remove from head to tail
            for (let i = 0; i < list.elements.length && removedCount < absCount; i++) {
                if (list.elements[i] === element) {
                    list.elements.splice(i, 1);
                    removedCount++;
                    i--; // Adjust index after removal
                }
            }
        } else {
            // Remove from tail to head
            for (let i = list.elements.length - 1; i >= 0 && removedCount < absCount; i--) {
                if (list.elements[i] === element) {
                    list.elements.splice(i, 1);
                    removedCount++;
                }
            }
        }

        // If list becomes empty, remove the key
        if (list.elements.length === 0) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * RPOPLPUSH source destination - Pop from right of source and push to left of destination
     * @param {Array<string>} args - Command arguments
     */
    rpoplpush(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'rpoplpush' command");
        }

        const [sourceKey, destinationKey] = args;
        const sourceList = this.getValue(sourceKey);

        if (sourceList === undefined) {
            return '(nil)';
        }

        if (this.getType(sourceKey) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Pop from source
        const element = sourceList.rpop();
        
        if (element === undefined) {
            return '(nil)';
        }

        // If source becomes empty, remove the key
        if (sourceList.elements.length === 0) {
            this.deleteKey(sourceKey);
        }

        // Push to destination
        let destinationList = this.getValue(destinationKey);
        if (destinationList === undefined) {
            destinationList = new RedisList();
            this.setValue(destinationKey, destinationList, 'list');
        } else if (this.getType(destinationKey) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        destinationList.lpush(element);
        
        return `"${element}"`;
    }

    /**
     * LMOVE source destination LEFT|RIGHT LEFT|RIGHT - Move element between lists
     * @param {Array<string>} args - Command arguments
     */
    lmove(args) {
        if (args.length !== 4) {
            throw new Error("ERR wrong number of arguments for 'lmove' command");
        }

        const [sourceKey, destinationKey, sourceSide, destinationSide] = args;
        
        // Validate sides
        const validSides = ['LEFT', 'RIGHT'];
        if (!validSides.includes(sourceSide.toUpperCase()) || !validSides.includes(destinationSide.toUpperCase())) {
            throw new Error("ERR syntax error");
        }

        const sourceList = this.getValue(sourceKey);

        if (sourceList === undefined) {
            return '(nil)';
        }

        if (this.getType(sourceKey) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Pop from source based on side
        let element;
        if (sourceSide.toUpperCase() === 'LEFT') {
            element = sourceList.lpop();
        } else {
            element = sourceList.rpop();
        }

        if (element === undefined) {
            return '(nil)';
        }

        // If source becomes empty, remove the key
        if (sourceList.elements.length === 0) {
            this.deleteKey(sourceKey);
        }

        // Push to destination based on side
        let destinationList = this.getValue(destinationKey);
        if (destinationList === undefined) {
            destinationList = new RedisList();
            this.setValue(destinationKey, destinationList, 'list');
        } else if (this.getType(destinationKey) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        if (destinationSide.toUpperCase() === 'LEFT') {
            destinationList.lpush(element);
        } else {
            destinationList.rpush(element);
        }

        return `"${element}"`;
    }

    /**
     * LPOS key element [RANK rank] [COUNT num] [MAXLEN len] - Find position of element
     * @param {Array<string>} args - Command arguments
     */
    lpos(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'lpos' command");
        }

        const [key, element, ...options] = args;
        const list = this.getValue(key);

        if (list === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let rank = 1; // Default: first occurrence
        let count = 1; // Default: return single position
        let maxlen = 0; // Default: no limit

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            
            if (option === 'RANK') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                rank = parseInt(options[i + 1], 10);
                if (isNaN(rank) || rank === 0) {
                    throw new Error("ERR RANK can't be zero: use 1 to start from the first match, 2 from the second ... or use negative numbers for the opposite order");
                }
                i++; // Skip next argument
            } else if (option === 'COUNT') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                count = parseInt(options[i + 1], 10);
                if (isNaN(count) || count < 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip next argument
            } else if (option === 'MAXLEN') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                maxlen = parseInt(options[i + 1], 10);
                if (isNaN(maxlen) || maxlen < 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip next argument
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const positions = [];
        const elements = list.elements;
        const searchLength = maxlen > 0 ? Math.min(maxlen, elements.length) : elements.length;
        
        let matchCount = 0;
        const absRank = Math.abs(rank);
        
        if (rank > 0) {
            // Search from left to right
            for (let i = 0; i < searchLength; i++) {
                if (elements[i] === element) {
                    matchCount++;
                    if (matchCount === absRank) {
                        positions.push(i);
                        if (count === 1) break;
                        if (positions.length >= count) break;
                    } else if (matchCount > absRank && count > 1) {
                        positions.push(i);
                        if (positions.length >= count) break;
                    }
                }
            }
        } else {
            // Search from right to left for negative rank
            for (let i = searchLength - 1; i >= 0; i--) {
                if (elements[i] === element) {
                    matchCount++;
                    if (matchCount === absRank) {
                        positions.unshift(i);
                        if (count === 1) break;
                        if (positions.length >= count) break;
                    } else if (matchCount > absRank && count > 1) {
                        positions.unshift(i);
                        if (positions.length >= count) break;
                    }
                }
            }
        }

        if (positions.length === 0) {
            return count === 1 ? '(nil)' : '(empty list or set)';
        }

        if (count === 1) {
            return `(integer) ${positions[0]}`;
        } else {
            return positions.map((pos, index) => `${index + 1}) (integer) ${pos}`).join('\n');
        }
    }

    /**
     * LMPOP numkeys key [key ...] LEFT|RIGHT [COUNT count] - Pop elements from multiple lists
     * @param {Array<string>} args - Command arguments
     */
    lmpop(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'lmpop' command");
        }

        const numkeys = parseInt(args[0], 10);
        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (args.length < 1 + numkeys + 1) {
            throw new Error("ERR wrong number of arguments for 'lmpop' command");
        }

        const keys = args.slice(1, 1 + numkeys);
        const direction = args[1 + numkeys];
        const remainingArgs = args.slice(2 + numkeys);

        if (!['LEFT', 'RIGHT'].includes(direction.toUpperCase())) {
            throw new Error("ERR syntax error");
        }

        let count = 1; // Default count

        // Parse remaining options
        for (let i = 0; i < remainingArgs.length; i++) {
            const option = remainingArgs[i].toUpperCase();
            if (option === 'COUNT') {
                if (i + 1 >= remainingArgs.length) {
                    throw new Error("ERR syntax error");
                }
                count = parseInt(remainingArgs[i + 1], 10);
                if (isNaN(count) || count <= 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip next argument
            } else {
                throw new Error("ERR syntax error");
            }
        }

        // Find first non-empty list
        for (const key of keys) {
            const list = this.getValue(key);
            
            if (list === undefined) {
                continue; // Skip non-existent keys
            }

            if (this.getType(key) !== 'list') {
                throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
            }

            if (list.elements.length === 0) {
                continue; // Skip empty lists
            }

            // Pop elements from this list
            const poppedElements = [];
            const maxPops = Math.min(count, list.elements.length);
            
            for (let i = 0; i < maxPops; i++) {
                let element;
                if (direction.toUpperCase() === 'LEFT') {
                    element = list.lpop();
                } else {
                    element = list.rpop();
                }
                if (element !== undefined) {
                    poppedElements.push(element);
                }
            }

            // If list becomes empty, remove the key
            if (list.elements.length === 0) {
                this.deleteKey(key);
            }

            // Return result in Redis format
            if (poppedElements.length > 0) {
                let result = `1) "${key}"\n2) `;
                if (poppedElements.length === 1) {
                    result += `1) "${poppedElements[0]}"`;
                } else {
                    result += poppedElements.map((elem, index) => `${index + 1}) "${elem}"`).join('\n   ');
                }
                return result;
            }
        }

        return '(nil)';
    }

    /**
     * BLPOP key [key ...] timeout - Blocking left pop from lists
     * @param {Array<string>} args - Command arguments
     */
    blpop(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'blpop' command");
        }

        const timeout = parseFloat(args[args.length - 1]);
        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        const keys = args.slice(0, -1);

        // Check each key for available elements
        for (const key of keys) {
            const list = this.getValue(key);
            
            if (list === undefined) {
                continue; // Skip non-existent keys
            }

            if (this.getType(key) !== 'list') {
                throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
            }

            if (list.elements.length > 0) {
                // Element is available - pop it
                const element = list.lpop();
                
                // If list becomes empty, remove the key
                if (list.elements.length === 0) {
                    this.deleteKey(key);
                }

                return `1) "${key}"\n2) "${element}"`;
            }
        }

        // No elements available - in a real Redis this would block
        // For this implementation, we simulate immediate timeout
        if (timeout === 0) {
            // Infinite timeout - in real Redis this would block indefinitely
            // For this implementation, return nil immediately
            return '(nil)';
        }

        // Simulate timeout (simplified - in real Redis this would actually wait)
        return '(nil)';
    }

    /**
     * BRPOP key [key ...] timeout - Blocking right pop from lists
     * @param {Array<string>} args - Command arguments
     */
    brpop(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'brpop' command");
        }

        const timeout = parseFloat(args[args.length - 1]);
        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        const keys = args.slice(0, -1);

        // Check each key for available elements
        for (const key of keys) {
            const list = this.getValue(key);
            
            if (list === undefined) {
                continue; // Skip non-existent keys
            }

            if (this.getType(key) !== 'list') {
                throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
            }

            if (list.elements.length > 0) {
                // Element is available - pop it
                const element = list.rpop();
                
                // If list becomes empty, remove the key
                if (list.elements.length === 0) {
                    this.deleteKey(key);
                }

                return `1) "${key}"\n2) "${element}"`;
            }
        }

        // No elements available - simulate timeout
        return '(nil)';
    }

    /**
     * BRPOPLPUSH source destination timeout - Blocking right pop and left push
     * @param {Array<string>} args - Command arguments
     */
    brpoplpush(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'brpoplpush' command");
        }

        const [sourceKey, destinationKey, timeoutStr] = args;
        const timeout = parseFloat(timeoutStr);
        
        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        const sourceList = this.getValue(sourceKey);

        // Check if source exists and has elements
        if (sourceList !== undefined) {
            if (this.getType(sourceKey) !== 'list') {
                throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
            }

            if (sourceList.elements.length > 0) {
                // Element is available - perform RPOPLPUSH
                const element = sourceList.rpop();
                
                // If source becomes empty, remove the key
                if (sourceList.elements.length === 0) {
                    this.deleteKey(sourceKey);
                }

                // Push to destination
                let destinationList = this.getValue(destinationKey);
                if (destinationList === undefined) {
                    destinationList = new RedisList();
                    this.setValue(destinationKey, destinationList, 'list');
                } else if (this.getType(destinationKey) !== 'list') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }

                destinationList.lpush(element);
                return `"${element}"`;
            }
        }

        // No elements available - simulate timeout
        return '(nil)';
    }

    /**
     * BLMOVE source destination LEFT|RIGHT LEFT|RIGHT timeout - Blocking move between lists
     * @param {Array<string>} args - Command arguments
     */
    blmove(args) {
        if (args.length !== 5) {
            throw new Error("ERR wrong number of arguments for 'blmove' command");
        }

        const [sourceKey, destinationKey, sourceSide, destinationSide, timeoutStr] = args;
        const timeout = parseFloat(timeoutStr);
        
        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        // Validate sides
        const validSides = ['LEFT', 'RIGHT'];
        if (!validSides.includes(sourceSide.toUpperCase()) || !validSides.includes(destinationSide.toUpperCase())) {
            throw new Error("ERR syntax error");
        }

        const sourceList = this.getValue(sourceKey);

        // Check if source exists and has elements
        if (sourceList !== undefined) {
            if (this.getType(sourceKey) !== 'list') {
                throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
            }

            if (sourceList.elements.length > 0) {
                // Element is available - perform LMOVE
                let element;
                if (sourceSide.toUpperCase() === 'LEFT') {
                    element = sourceList.lpop();
                } else {
                    element = sourceList.rpop();
                }

                // If source becomes empty, remove the key
                if (sourceList.elements.length === 0) {
                    this.deleteKey(sourceKey);
                }

                // Push to destination
                let destinationList = this.getValue(destinationKey);
                if (destinationList === undefined) {
                    destinationList = new RedisList();
                    this.setValue(destinationKey, destinationList, 'list');
                } else if (this.getType(destinationKey) !== 'list') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }

                if (destinationSide.toUpperCase() === 'LEFT') {
                    destinationList.lpush(element);
                } else {
                    destinationList.rpush(element);
                }

                return `"${element}"`;
            }
        }

        // No elements available - simulate timeout
        return '(nil)';
    }

    /**
     * BLMPOP timeout numkeys key [key ...] LEFT|RIGHT [COUNT count] - Blocking pop from multiple lists
     * @param {Array<string>} args - Command arguments
     */
    blmpop(args) {
        if (args.length < 4) {
            throw new Error("ERR wrong number of arguments for 'blmpop' command");
        }

        const timeout = parseFloat(args[0]);
        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        const numkeys = parseInt(args[1], 10);
        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (args.length < 2 + numkeys + 1) {
            throw new Error("ERR wrong number of arguments for 'blmpop' command");
        }

        const keys = args.slice(2, 2 + numkeys);
        const direction = args[2 + numkeys];
        const remainingArgs = args.slice(3 + numkeys);

        if (!['LEFT', 'RIGHT'].includes(direction.toUpperCase())) {
            throw new Error("ERR syntax error");
        }

        let count = 1; // Default count

        // Parse remaining options
        for (let i = 0; i < remainingArgs.length; i++) {
            const option = remainingArgs[i].toUpperCase();
            if (option === 'COUNT') {
                if (i + 1 >= remainingArgs.length) {
                    throw new Error("ERR syntax error");
                }
                count = parseInt(remainingArgs[i + 1], 10);
                if (isNaN(count) || count <= 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip next argument
            } else {
                throw new Error("ERR syntax error");
            }
        }

        // Find first non-empty list (same logic as LMPOP)
        for (const key of keys) {
            const list = this.getValue(key);
            
            if (list === undefined) {
                continue; // Skip non-existent keys
            }

            if (this.getType(key) !== 'list') {
                throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
            }

            if (list.elements.length === 0) {
                continue; // Skip empty lists
            }

            // Pop elements from this list
            const poppedElements = [];
            const maxPops = Math.min(count, list.elements.length);
            
            for (let i = 0; i < maxPops; i++) {
                let element;
                if (direction.toUpperCase() === 'LEFT') {
                    element = list.lpop();
                } else {
                    element = list.rpop();
                }
                if (element !== undefined) {
                    poppedElements.push(element);
                }
            }

            // If list becomes empty, remove the key
            if (list.elements.length === 0) {
                this.deleteKey(key);
            }

            // Return result in Redis format
            if (poppedElements.length > 0) {
                let result = `1) "${key}"\n2) `;
                if (poppedElements.length === 1) {
                    result += `1) "${poppedElements[0]}"`;
                } else {
                    result += poppedElements.map((elem, index) => `${index + 1}) "${elem}"`).join('\n   ');
                }
                return result;
            }
        }

        // No elements available - simulate timeout
        return '(nil)';
    }

    /**
     * TYPE key - Get the type of key (debug command)
     * @param {Array<string>} args - Command arguments
     */
    type(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'type' command");
        }

        const key = args[0];
        const type = this.getType(key);
        return type;
    }

    // ===== PHASE 4 COMMANDS - SET OPERATIONS =====

    /**
     * SADD key member [member ...] - Add members to set
     * @param {Array<string>} args - Command arguments
     */
    sadd(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'sadd' command");
        }

        const [key, ...members] = args;
        
        // Check if key exists and ensure it's a set or doesn't exist
        if (!this.checkType(key, 'set')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let set = this.getValue(key);
        if (set === undefined) {
            set = new RedisSet();
            this.setValue(key, set, 'set');
        }

        const addedCount = set.sadd(...members);
        return `(integer) ${addedCount}`;
    }

    /**
     * SREM key member [member ...] - Remove members from set
     * @param {Array<string>} args - Command arguments
     */
    srem(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'srem' command");
        }

        const [key, ...members] = args;
        const set = this.getValue(key);

        if (set === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const removedCount = set.srem(...members);

        // If set becomes empty, remove the key
        if (set.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * SMEMBERS key - Get all members of set
     * @param {Array<string>} args - Command arguments
     */
    smembers(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'smembers' command");
        }

        const key = args[0];
        const set = this.getValue(key);

        if (set === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const members = set.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SCARD key - Get number of members in set
     * @param {Array<string>} args - Command arguments
     */
    scard(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'scard' command");
        }

        const key = args[0];
        const set = this.getValue(key);

        if (set === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${set.scard()}`;
    }

    /**
     * SISMEMBER key member - Check if member exists in set
     * @param {Array<string>} args - Command arguments
     */
    sismember(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'sismember' command");
        }

        const [key, member] = args;
        const set = this.getValue(key);

        if (set === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${set.sismember(member) ? 1 : 0}`;
    }

    /**
     * SUNION key [key ...] - Union of sets
     * @param {Array<string>} args - Command arguments
     */
    sunion(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'sunion' command");
        }

        const keys = args;
        const sets = [];

        // Get all sets, checking types
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                sets.push(set);
            }
            // Non-existent keys are treated as empty sets in Redis
        }

        // If no sets exist, return empty
        if (sets.length === 0) {
            return '(empty list or set)';
        }

        // Calculate union
        const firstSet = sets[0];
        const otherSets = sets.slice(1);
        const unionSet = firstSet.sunion(...otherSets);

        const members = unionSet.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SINTER key [key ...] - Intersection of sets
     * @param {Array<string>} args - Command arguments
     */
    sinter(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'sinter' command");
        }

        const keys = args;
        const sets = [];

        // Get all sets, checking types
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                sets.push(set);
            } else {
                // If any set doesn't exist, intersection is empty
                return '(empty list or set)';
            }
        }

        // If no sets exist, return empty
        if (sets.length === 0) {
            return '(empty list or set)';
        }

        // Calculate intersection
        const firstSet = sets[0];
        const otherSets = sets.slice(1);
        const intersectionSet = firstSet.sinter(...otherSets);

        const members = intersectionSet.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SDIFF key [key ...] - Difference of sets (first set minus others)
     * @param {Array<string>} args - Command arguments
     */
    sdiff(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'sdiff' command");
        }

        const keys = args;
        const firstKey = keys[0];
        const otherKeys = keys.slice(1);

        // Get first set
        const firstSet = this.getValue(firstKey);
        if (firstSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(firstKey) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Get other sets
        const otherSets = [];
        for (const key of otherKeys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                otherSets.push(set);
            }
            // Non-existent keys are treated as empty sets
        }

        // Calculate difference
        const diffSet = firstSet.sdiff(...otherSets);

        const members = diffSet.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SPOP key [count] - Remove and return random member(s)
     * @param {Array<string>} args - Command arguments
     */
    spop(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'spop' command");
        }

        const [key, countStr] = args;
        let count = 1;
        
        if (countStr !== undefined) {
            count = parseInt(countStr, 10);
            if (isNaN(count) || count < 0) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        const set = this.getValue(key);

        if (set === undefined) {
            return args.length === 1 ? '(nil)' : '(empty list or set)';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const members = Array.from(set.members);
        const result = [];
        
        for (let i = 0; i < count && members.length > 0; i++) {
            const randomIndex = Math.floor(Math.random() * members.length);
            const member = members.splice(randomIndex, 1)[0];
            set.members.delete(member);
            result.push(member);
        }

        // If set becomes empty, remove the key
        if (set.isEmpty()) {
            this.deleteKey(key);
        }

        if (args.length === 1) {
            return result.length > 0 ? `"${result[0]}"` : '(nil)';
        } else {
            if (result.length === 0) {
                return '(empty list or set)';
            }
            return result.map((member, index) => `${index + 1}) "${member}"`).join('\n');
        }
    }

    /**
     * SRANDMEMBER key [count] - Get random member(s) without removing
     * @param {Array<string>} args - Command arguments
     */
    srandmember(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'srandmember' command");
        }

        const [key, countStr] = args;
        const set = this.getValue(key);

        if (set === undefined) {
            return args.length === 1 ? '(nil)' : '(empty list or set)';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const members = Array.from(set.members);
        
        if (countStr === undefined) {
            // Single random member
            if (members.length === 0) {
                return '(nil)';
            }
            const randomMember = members[Math.floor(Math.random() * members.length)];
            return `"${randomMember}"`;
        }

        const count = parseInt(countStr, 10);
        if (isNaN(count)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const result = [];
        const absCount = Math.abs(count);
        
        if (count >= 0) {
            // No duplicates - shuffle and take first 'count' elements
            const shuffled = [...members];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            result.push(...shuffled.slice(0, Math.min(absCount, shuffled.length)));
        } else {
            // Allow duplicates
            for (let i = 0; i < absCount; i++) {
                if (members.length === 0) break;
                const randomMember = members[Math.floor(Math.random() * members.length)];
                result.push(randomMember);
            }
        }

        if (result.length === 0) {
            return '(empty list or set)';
        }

        return result.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SMOVE source destination member - Move member between sets
     * @param {Array<string>} args - Command arguments
     */
    smove(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'smove' command");
        }

        const [sourceKey, destinationKey, member] = args;
        const sourceSet = this.getValue(sourceKey);

        if (sourceSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(sourceKey) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Check if member exists in source
        if (!sourceSet.members.has(member)) {
            return '(integer) 0';
        }

        // Remove from source
        sourceSet.members.delete(member);

        // If source becomes empty, remove the key
        if (sourceSet.isEmpty()) {
            this.deleteKey(sourceKey);
        }

        // Add to destination
        let destinationSet = this.getValue(destinationKey);
        if (destinationSet === undefined) {
            destinationSet = new RedisSet();
            this.setValue(destinationKey, destinationSet, 'set');
        } else if (this.getType(destinationKey) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        destinationSet.members.add(member);

        return '(integer) 1';
    }

    /**
     * SUNIONSTORE destination key [key ...] - Store union result
     * @param {Array<string>} args - Command arguments
     */
    sunionstore(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'sunionstore' command");
        }

        const [destinationKey, ...keys] = args;
        const sets = [];

        // Get all sets
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                sets.push(set);
            }
        }

        // Calculate union
        const unionSet = new RedisSet();
        for (const set of sets) {
            for (const member of set.members) {
                unionSet.members.add(member);
            }
        }

        if (unionSet.isEmpty()) {
            // Remove destination key if it exists
            this.deleteKey(destinationKey);
            return '(integer) 0';
        } else {
            this.setValue(destinationKey, unionSet, 'set');
            return `(integer) ${unionSet.scard()}`;
        }
    }

    /**
     * SINTERSTORE destination key [key ...] - Store intersection result
     * @param {Array<string>} args - Command arguments
     */
    sinterstore(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'sinterstore' command");
        }

        const [destinationKey, ...keys] = args;
        const sets = [];

        // Get all sets
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                sets.push(set);
            } else {
                // If any set doesn't exist, intersection is empty
                this.deleteKey(destinationKey);
                return '(integer) 0';
            }
        }

        if (sets.length === 0) {
            this.deleteKey(destinationKey);
            return '(integer) 0';
        }

        // Calculate intersection
        const firstSet = sets[0];
        const otherSets = sets.slice(1);
        const intersectionSet = firstSet.sinter(...otherSets);

        if (intersectionSet.isEmpty()) {
            this.deleteKey(destinationKey);
            return '(integer) 0';
        } else {
            this.setValue(destinationKey, intersectionSet, 'set');
            return `(integer) ${intersectionSet.scard()}`;
        }
    }

    /**
     * SDIFFSTORE destination key [key ...] - Store difference result
     * @param {Array<string>} args - Command arguments
     */
    sdiffstore(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'sdiffstore' command");
        }

        const [destinationKey, ...keys] = args;
        const firstKey = keys[0];
        const otherKeys = keys.slice(1);

        // Get first set
        const firstSet = this.getValue(firstKey);
        if (firstSet === undefined) {
            this.deleteKey(destinationKey);
            return '(integer) 0';
        }

        if (this.getType(firstKey) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Get other sets
        const otherSets = [];
        for (const key of otherKeys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                otherSets.push(set);
            }
        }

        // Calculate difference
        const diffSet = firstSet.sdiff(...otherSets);

        if (diffSet.isEmpty()) {
            this.deleteKey(destinationKey);
            return '(integer) 0';
        } else {
            this.setValue(destinationKey, diffSet, 'set');
            return `(integer) ${diffSet.scard()}`;
        }
    }

    /**
     * SINTERCARD numkeys key [key ...] [LIMIT limit] - Get cardinality of intersection
     * @param {Array<string>} args - Command arguments
     */
    sintercard(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'sintercard' command");
        }

        const numkeys = parseInt(args[0], 10);
        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (args.length < 1 + numkeys) {
            throw new Error("ERR wrong number of arguments for 'sintercard' command");
        }

        const keys = args.slice(1, 1 + numkeys);
        const options = args.slice(1 + numkeys);

        let limit = 0; // 0 means no limit

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            if (option === 'LIMIT') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                limit = parseInt(options[i + 1], 10);
                if (isNaN(limit) || limit < 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip next argument
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const sets = [];

        // Get all sets, checking types
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                sets.push(set);
            } else {
                // If any set doesn't exist, intersection is empty
                return '(integer) 0';
            }
        }

        if (sets.length === 0) {
            return '(integer) 0';
        }

        // Calculate intersection cardinality
        const firstSet = sets[0];
        const otherSets = sets.slice(1);
        const intersectionSet = firstSet.sinter(...otherSets);
        
        let cardinality = intersectionSet.scard();
        
        // Apply limit if specified
        if (limit > 0 && cardinality > limit) {
            cardinality = limit;
        }

        return `(integer) ${cardinality}`;
    }

    /**
     * SMISMEMBER key member [member ...] - Check if multiple members exist
     * @param {Array<string>} args - Command arguments
     */
    smismember(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'smismember' command");
        }

        const [key, ...members] = args;
        const set = this.getValue(key);

        if (set === undefined) {
            // All members return 0 for non-existent set
            return members.map(() => '(integer) 0').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = members.map(member => set.sismember(member) ? 1 : 0);
        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * SSCAN key cursor [MATCH pattern] [COUNT count] - Incrementally iterate set members
     * @param {Array<string>} args - Command arguments
     */
    sscan(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'sscan' command");
        }

        const [key, cursorStr, ...options] = args;
        const cursor = parseInt(cursorStr, 10);
        
        if (isNaN(cursor) || cursor < 0) {
            throw new Error("ERR invalid cursor");
        }

        let pattern = '*';
        let count = 10;

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            if (option === 'MATCH') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                pattern = options[i + 1];
                i++; // Skip next argument
            } else if (option === 'COUNT') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                count = parseInt(options[i + 1], 10);
                if (isNaN(count) || count <= 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip next argument
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const set = this.getValue(key);

        if (set === undefined) {
            return '1) "0"\n2) (empty list or set)';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const members = Array.from(set.members);
        
        // Convert pattern to regex
        let regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`);
        
        // Filter members by pattern
        const filteredMembers = members.filter(member => regex.test(member));
        
        // Calculate slice bounds
        const start = cursor;
        const end = Math.min(start + count, filteredMembers.length);
        const slice = filteredMembers.slice(start, end);
        
        // Determine next cursor
        const nextCursor = end >= filteredMembers.length ? 0 : end;
        
        let response = `1) "${nextCursor}"`;
        if (slice.length === 0) {
            response += '\n2) (empty list or set)';
        } else {
            response += '\n2) ';
            response += slice.map((member, index) => `${index + 1}) "${member}"`).join('\n   ');
        }
        
        return response;
    }

    // ===== PHASE 5 COMMANDS - HASH OPERATIONS =====

    /**
     * HSET key field value [field value ...] - Set field(s) in hash
     * @param {Array<string>} args - Command arguments
     */
    hset(args) {
        if (args.length < 3 || args.length % 2 === 0) {
            throw new Error("ERR wrong number of arguments for 'hset' command");
        }

        const [key, ...fieldValuePairs] = args;
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const newFieldsCount = hash.hset(...fieldValuePairs);
        return `(integer) ${newFieldsCount}`;
    }

    /**
     * HGET key field - Get field value from hash
     * @param {Array<string>} args - Command arguments
     */
    hget(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'hget' command");
        }

        const [key, field] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const value = hash.hget(field);
        return value === undefined ? '(nil)' : `"${value}"`;
    }

    /**
     * HMGET key field [field ...] - Get multiple field values
     * @param {Array<string>} args - Command arguments
     */
    hmget(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hmget' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            // Return nil for all fields if hash doesn't exist
            return fields.map(() => '(nil)').map((nil, index) => `${index + 1}) ${nil}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const values = hash.hmget(...fields);
        return values.map((value, index) => 
            `${index + 1}) ${value === undefined ? '(nil)' : `"${value}"`}`
        ).join('\n');
    }

    /**
     * HGETALL key - Get all field-value pairs
     * @param {Array<string>} args - Command arguments
     */
    hgetall(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hgetall' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const fieldValuePairs = hash.hgetall();
        
        if (fieldValuePairs.length === 0) {
            return '(empty list or set)';
        }

        return fieldValuePairs.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * HDEL key field [field ...] - Delete field(s) from hash
     * @param {Array<string>} args - Command arguments
     */
    hdel(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hdel' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const deletedCount = hash.hdel(...fields);

        // If hash becomes empty, remove the key
        if (hash.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${deletedCount}`;
    }

    /**
     * HEXISTS key field - Check if field exists in hash
     * @param {Array<string>} args - Command arguments
     */
    hexists(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'hexists' command");
        }

        const [key, field] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${hash.hexists(field) ? 1 : 0}`;
    }

    /**
     * HKEYS key - Get all field names
     * @param {Array<string>} args - Command arguments
     */
    hkeys(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hkeys' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const fields = hash.hkeys();
        
        if (fields.length === 0) {
            return '(empty list or set)';
        }

        return fields.map((field, index) => `${index + 1}) "${field}"`).join('\n');
    }

    /**
     * HVALS key - Get all values
     * @param {Array<string>} args - Command arguments
     */
    hvals(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hvals' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const values = hash.hvals();
        
        if (values.length === 0) {
            return '(empty list or set)';
        }

        return values.map((value, index) => `${index + 1}) "${value}"`).join('\n');
    }

    /**
     * HLEN key - Get number of fields in hash
     * @param {Array<string>} args - Command arguments
     */
    hlen(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hlen' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${hash.hlen()}`;
    }

    /**
     * HINCRBY key field increment - Increment field by integer
     * @param {Array<string>} args - Command arguments
     */
    hincrby(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'hincrby' command");
        }

        const [key, field, incrementStr] = args;
        const increment = parseInt(incrementStr, 10);
        
        if (isNaN(increment)) {
            throw new Error("ERR value is not an integer or out of range");
        }
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const newValue = hash.hincrby(field, increment);
        return `(integer) ${newValue}`;
    }

    /**
     * HINCRBYFLOAT key field increment - Increment field by float
     * @param {Array<string>} args - Command arguments
     */
    hincrbyfloat(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'hincrbyfloat' command");
        }

        const [key, field, incrementStr] = args;
        const increment = parseFloat(incrementStr);
        
        if (isNaN(increment)) {
            throw new Error("ERR value is not a valid float");
        }
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const newValue = hash.hincrbyfloat(field, increment);
        return `"${newValue}"`;
    }

    /**
     * HSETNX key field value - Set field only if it doesn't exist
     * @param {Array<string>} args - Command arguments
     */
    hsetnx(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'hsetnx' command");
        }

        const [key, field, value] = args;
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const wasSet = hash.hsetnx(field, value);
        return `(integer) ${wasSet ? 1 : 0}`;
    }

    /**
     * HMSET key field value [field value ...] - Set multiple fields (legacy command)
     * @param {Array<string>} args - Command arguments
     */
    hmset(args) {
        if (args.length < 3 || args.length % 2 === 0) {
            throw new Error("ERR wrong number of arguments for 'hmset' command");
        }

        const [key, ...fieldValuePairs] = args;
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        hash.hmset(...fieldValuePairs);
        return 'OK';
    }

    /**
     * HSTRLEN key field - Get the length of hash field value
     * @param {Array<string>} args - Command arguments
     */
    hstrlen(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'hstrlen' command");
        }

        const [key, field] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const length = hash.hstrlen(field);
        return `(integer) ${length}`;
    }

    /**
     * HSCAN key cursor [MATCH pattern] [COUNT count] - Incrementally iterate hash fields
     * @param {Array<string>} args - Command arguments
     */
    hscan(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hscan' command");
        }

        const [key, cursorStr, ...options] = args;
        const cursor = parseInt(cursorStr, 10);
        
        if (isNaN(cursor) || cursor < 0) {
            throw new Error("ERR invalid cursor");
        }

        let pattern = '*';
        let count = 10;

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            if (option === 'MATCH') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                pattern = options[i + 1];
                i++; // Skip next argument
            } else if (option === 'COUNT') {
                if (i + 1 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                count = parseInt(options[i + 1], 10);
                if (isNaN(count) || count <= 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip next argument
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const hash = this.getValue(key);

        if (hash === undefined) {
            return '1) "0"\n2) (empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const [nextCursor, results] = hash.hscan(cursor, pattern, count);
        
        let response = `1) "${nextCursor}"`;
        if (results.length === 0) {
            response += '\n2) (empty list or set)';
        } else {
            response += '\n2) ';
            response += results.map((item, index) => `${index + 1}) "${item}"`).join('\n   ');
        }
        
        return response;
    }

    /**
     * HRANDFIELD key [count [WITHVALUES]] - Get random field(s) from hash
     * @param {Array<string>} args - Command arguments
     */
    hrandfield(args) {
        if (args.length === 0 || args.length > 3) {
            throw new Error("ERR wrong number of arguments for 'hrandfield' command");
        }

        const [key, countStr, withValuesStr] = args;
        let count = 1;
        let withValues = false;

        if (countStr !== undefined) {
            count = parseInt(countStr, 10);
            if (isNaN(count)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        if (withValuesStr !== undefined) {
            if (withValuesStr.toUpperCase() === 'WITHVALUES') {
                withValues = true;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const hash = this.getValue(key);

        if (hash === undefined) {
            return args.length === 1 ? '(nil)' : '(empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = hash.hrandfield(count, withValues);
        
        if (results.length === 0) {
            return args.length === 1 ? '(nil)' : '(empty list or set)';
        }

        if (args.length === 1) {
            // Single field, return as string
            return `"${results[0]}"`;
        } else {
            // Multiple fields/values, return as array
            return results.map((item, index) => `${index + 1}) "${item}"`).join('\n');
        }
    }

    /**
     * HGETDEL key field - Get field value and delete it atomically
     * @param {Array<string>} args - Command arguments
     */
    hgetdel(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'hgetdel' command");
        }

        const [key, field] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const value = hash.getField(field);
        if (value === undefined) {
            return '(nil)';
        }

        // Delete the field
        hash.fields.delete(field);
        hash.fieldExpirations.delete(field);

        // If hash becomes empty, remove the key
        if (hash.isEmpty()) {
            this.deleteKey(key);
        }

        return `"${value}"`;
    }

    /**
     * HEXPIRE key seconds field [field ...] - Set field expiration in seconds
     * @param {Array<string>} args - Command arguments
     */
    hexpire(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'hexpire' command");
        }

        const [key, secondsStr, ...fields] = args;
        const seconds = parseInt(secondsStr, 10);
        
        if (isNaN(seconds) || seconds < 0) {
            throw new Error("ERR invalid expire time");
        }

        const hash = this.getValue(key);
        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const expireTime = Date.now() + (seconds * 1000);
        const results = fields.map(field => {
            return hash.setFieldExpiration(field, expireTime) ? 1 : -2;
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HEXPIREAT key timestamp field [field ...] - Set field expiration at Unix timestamp
     * @param {Array<string>} args - Command arguments
     */
    hexpireat(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'hexpireat' command");
        }

        const [key, timestampStr, ...fields] = args;
        const timestamp = parseInt(timestampStr, 10);
        
        if (isNaN(timestamp) || timestamp < 0) {
            throw new Error("ERR invalid expire time");
        }

        const hash = this.getValue(key);
        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const expireTime = timestamp * 1000; // Convert to milliseconds
        const results = fields.map(field => {
            return hash.setFieldExpiration(field, expireTime) ? 1 : -2;
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HEXPIRETIME key field [field ...] - Get field expiration timestamp
     * @param {Array<string>} args - Command arguments
     */
    hexpiretime(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hexpiretime' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = fields.map(field => {
            const ttl = hash.getFieldTTL(field);
            if (ttl === -2) return -2; // Field doesn't exist
            if (ttl === -1) return -1; // No expiration
            return Math.floor((Date.now() + ttl) / 1000); // Return timestamp in seconds
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HPEXPIRE key milliseconds field [field ...] - Set field expiration in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    hpexpire(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'hpexpire' command");
        }

        const [key, millisecondsStr, ...fields] = args;
        const milliseconds = parseInt(millisecondsStr, 10);
        
        if (isNaN(milliseconds) || milliseconds < 0) {
            throw new Error("ERR invalid expire time");
        }

        const hash = this.getValue(key);
        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const expireTime = Date.now() + milliseconds;
        const results = fields.map(field => {
            return hash.setFieldExpiration(field, expireTime) ? 1 : -2;
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HPEXPIREAT key milliseconds-timestamp field [field ...] - Set field expiration at millisecond timestamp
     * @param {Array<string>} args - Command arguments
     */
    hpexpireat(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'hpexpireat' command");
        }

        const [key, timestampStr, ...fields] = args;
        const timestamp = parseInt(timestampStr, 10);
        
        if (isNaN(timestamp) || timestamp < 0) {
            throw new Error("ERR invalid expire time");
        }

        const hash = this.getValue(key);
        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = fields.map(field => {
            return hash.setFieldExpiration(field, timestamp) ? 1 : -2;
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HPEXPIRETIME key field [field ...] - Get field expiration timestamp in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    hpexpiretime(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hpexpiretime' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = fields.map(field => {
            const ttl = hash.getFieldTTL(field);
            if (ttl === -2) return -2; // Field doesn't exist
            if (ttl === -1) return -1; // No expiration
            return Date.now() + ttl; // Return timestamp in milliseconds
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HTTL key field [field ...] - Get field time to live in seconds
     * @param {Array<string>} args - Command arguments
     */
    httl(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'httl' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = fields.map(field => {
            const ttlMs = hash.getFieldTTL(field);
            if (ttlMs === -2) return -2; // Field doesn't exist
            if (ttlMs === -1) return -1; // No expiration
            return Math.ceil(ttlMs / 1000); // Convert to seconds
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HPTTL key field [field ...] - Get field time to live in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    hpttl(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hpttl' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = fields.map(field => {
            return hash.getFieldTTL(field);
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    /**
     * HPERSIST key field [field ...] - Remove field expiration
     * @param {Array<string>} args - Command arguments
     */
    hpersist(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hpersist' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return fields.map(() => '(integer) -2').map((result, index) => `${index + 1}) ${result}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = fields.map(field => {
            if (!hash.fields.has(field) || hash.isFieldExpired(field)) {
                return -2; // Field doesn't exist
            }
            return hash.persistField(field) ? 1 : -1; // 1 if had expiration, -1 if no expiration
        });

        return results.map((result, index) => `${index + 1}) (integer) ${result}`).join('\n');
    }

    // ===== PHASE 6 COMMANDS - SORTED SET OPERATIONS =====

    /**
     * ZADD key score member [score member ...] - Add members with scores to sorted set
     * @param {Array<string>} args - Command arguments
     */
    zadd(args) {
        if (args.length < 3 || args.length % 2 === 0) {
            throw new Error("ERR wrong number of arguments for 'zadd' command");
        }

        const [key, ...scoreMemberPairs] = args;
        
        // Check if key exists and ensure it's a sorted set or doesn't exist
        if (!this.checkType(key, 'zset')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let sortedSet = this.getValue(key);
        if (sortedSet === undefined) {
            sortedSet = new RedisSortedSet();
            this.setValue(key, sortedSet, 'zset');
        }

        const addedCount = sortedSet.zadd(...scoreMemberPairs);
        return `(integer) ${addedCount}`;
    }

    /**
     * ZREM key member [member ...] - Remove members from sorted set
     * @param {Array<string>} args - Command arguments
     */
    zrem(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'zrem' command");
        }

        const [key, ...members] = args;
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const removedCount = sortedSet.zrem(...members);

        // If sorted set becomes empty, remove the key
        if (sortedSet.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * ZSCORE key member - Get score of member
     * @param {Array<string>} args - Command arguments
     */
    zscore(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'zscore' command");
        }

        const [key, member] = args;
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const score = sortedSet.zscore(member);
        return score === undefined ? '(nil)' : `"${score}"`;
    }

    /**
     * ZRANK key member - Get rank (0-based index) of member
     * @param {Array<string>} args - Command arguments
     */
    zrank(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'zrank' command");
        }

        const [key, member] = args;
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const rank = sortedSet.zrank(member);
        return rank === undefined ? '(nil)' : `(integer) ${rank}`;
    }

    /**
     * ZREVRANK key member - Get reverse rank (0-based index from highest score) of member
     * @param {Array<string>} args - Command arguments
     */
    zrevrank(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'zrevrank' command");
        }

        const [key, member] = args;
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const rank = sortedSet.zrevrank(member);
        return rank === undefined ? '(nil)' : `(integer) ${rank}`;
    }

    /**
     * ZRANGE key start stop [WITHSCORES] - Get range of members by rank
     * @param {Array<string>} args - Command arguments
     */
    zrange(args) {
        if (args.length < 3 || args.length > 4) {
            throw new Error("ERR wrong number of arguments for 'zrange' command");
        }

        const [key, startStr, stopStr, ...options] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const withScores = options.length > 0 && options[0].toUpperCase() === 'WITHSCORES';

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const result = sortedSet.zrange(start, stop, withScores);
        
        if (result.length === 0) {
            return '(empty list or set)';
        }

        return result.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * ZREVRANGE key start stop [WITHSCORES] - Get range of members by rank (reverse order)
     * @param {Array<string>} args - Command arguments
     */
    zrevrange(args) {
        if (args.length < 3 || args.length > 4) {
            throw new Error("ERR wrong number of arguments for 'zrevrange' command");
        }

        const [key, startStr, stopStr, ...options] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const withScores = options.length > 0 && options[0].toUpperCase() === 'WITHSCORES';

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const result = sortedSet.zrange(start, stop, withScores, true);
        
        if (result.length === 0) {
            return '(empty list or set)';
        }

        return result.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * Parse Redis-style score value (supports -inf, +inf, and regular floats)
     * @param {string} scoreStr - Score string to parse
     * @returns {number} - Parsed score value
     * @private
     */
    _parseScore(scoreStr) {
        if (scoreStr === '-inf') {
            return -Infinity;
        }
        if (scoreStr === '+inf' || scoreStr === 'inf') {
            return Infinity;
        }
        const score = parseFloat(scoreStr);
        if (isNaN(score)) {
            throw new Error("ERR min or max is not a float");
        }
        return score;
    }

    /**
     * ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count] - Get range of members by score
     * @param {Array<string>} args - Command arguments
     */
    zrangebyscore(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zrangebyscore' command");
        }

        const [key, minStr, maxStr, ...options] = args;
        let min, max;
        
        try {
            min = this._parseScore(minStr);
            max = this._parseScore(maxStr);
        } catch (error) {
            throw error;
        }

        let withScores = false;
        let offset = 0;
        let count = -1;

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            if (option === 'WITHSCORES') {
                withScores = true;
            } else if (option === 'LIMIT') {
                if (i + 2 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                offset = parseInt(options[i + 1], 10);
                count = parseInt(options[i + 2], 10);
                if (isNaN(offset) || isNaN(count)) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i += 2;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const result = sortedSet.zrangebyscore(min, max, withScores, false, offset, count);
        
        if (result.length === 0) {
            return '(empty list or set)';
        }

        return result.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * ZREVRANGEBYSCORE key max min [WITHSCORES] [LIMIT offset count] - Get range of members by score (reverse)
     * @param {Array<string>} args - Command arguments
     */
    zrevrangebyscore(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zrevrangebyscore' command");
        }

        const [key, maxStr, minStr, ...options] = args; // Note: max and min are swapped for reverse
        let min, max;
        
        try {
            min = this._parseScore(minStr);
            max = this._parseScore(maxStr);
        } catch (error) {
            throw error;
        }

        let withScores = false;
        let offset = 0;
        let count = -1;

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            if (option === 'WITHSCORES') {
                withScores = true;
            } else if (option === 'LIMIT') {
                if (i + 2 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                offset = parseInt(options[i + 1], 10);
                count = parseInt(options[i + 2], 10);
                if (isNaN(offset) || isNaN(count)) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i += 2;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const result = sortedSet.zrangebyscore(min, max, withScores, true, offset, count);
        
        if (result.length === 0) {
            return '(empty list or set)';
        }

        return result.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * ZCOUNT key min max - Count members in score range
     * @param {Array<string>} args - Command arguments
     */
    zcount(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'zcount' command");
        }

        const [key, minStr, maxStr] = args;
        let min, max;
        
        try {
            min = this._parseScore(minStr);
            max = this._parseScore(maxStr);
        } catch (error) {
            throw error;
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const count = sortedSet.zcount(min, max);
        return `(integer) ${count}`;
    }

    /**
     * ZCARD key - Get number of members in sorted set
     * @param {Array<string>} args - Command arguments
     */
    zcard(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'zcard' command");
        }

        const key = args[0];
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${sortedSet.zcard()}`;
    }

    /**
     * ZINCRBY key increment member - Increment score of member
     * @param {Array<string>} args - Command arguments
     */
    zincrby(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'zincrby' command");
        }

        const [key, incrementStr, member] = args;
        const increment = parseFloat(incrementStr);
        
        if (isNaN(increment)) {
            throw new Error("ERR value is not a valid float");
        }
        
        // Check if key exists and ensure it's a sorted set or doesn't exist
        if (!this.checkType(key, 'zset')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let sortedSet = this.getValue(key);
        if (sortedSet === undefined) {
            sortedSet = new RedisSortedSet();
            this.setValue(key, sortedSet, 'zset');
        }

        const newScore = sortedSet.zincrby(member, increment);
        return `"${newScore}"`;
    }

    /**
     * ZREMRANGEBYRANK key start stop - Remove members by rank range
     * @param {Array<string>} args - Command arguments
     */
    zremrangebyrank(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'zremrangebyrank' command");
        }

        const [key, startStr, stopStr] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const removedCount = sortedSet.zremrangebyrank(start, stop);

        // If sorted set becomes empty, remove the key
        if (sortedSet.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * ZREMRANGEBYSCORE key min max - Remove members by score range
     * @param {Array<string>} args - Command arguments
     */
    zremrangebyscore(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'zremrangebyscore' command");
        }

        const [key, minStr, maxStr] = args;
        let min, max;
        
        try {
            min = this._parseScore(minStr);
            max = this._parseScore(maxStr);
        } catch (error) {
            throw error;
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const removedCount = sortedSet.zremrangebyscore(min, max);

        // If sorted set becomes empty, remove the key
        if (sortedSet.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * ZRANGEBYLEX key min max [LIMIT offset count] - Get range of members by lexicographical order
     * @param {Array<string>} args - Command arguments
     */
    zrangebylex(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zrangebylex' command");
        }

        const [key, min, max, ...options] = args;
        let offset = 0;
        let count = -1;

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            if (option === 'LIMIT') {
                if (i + 2 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                offset = parseInt(options[i + 1], 10);
                count = parseInt(options[i + 2], 10);
                if (isNaN(offset) || isNaN(count)) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i += 2;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const result = sortedSet.zrangebylex(min, max, offset, count, false);
        
        if (result.length === 0) {
            return '(empty list or set)';
        }

        return result.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * ZREVRANGEBYLEX key max min [LIMIT offset count] - Get range of members by lexicographical order (reverse)
     * @param {Array<string>} args - Command arguments
     */
    zrevrangebylex(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zrevrangebylex' command");
        }

        const [key, max, min, ...options] = args; // Note: max and min are swapped for reverse
        let offset = 0;
        let count = -1;

        // Parse options
        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            if (option === 'LIMIT') {
                if (i + 2 >= options.length) {
                    throw new Error("ERR syntax error");
                }
                offset = parseInt(options[i + 1], 10);
                count = parseInt(options[i + 2], 10);
                if (isNaN(offset) || isNaN(count)) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i += 2;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const result = sortedSet.zrangebylex(min, max, offset, count, true);
        
        if (result.length === 0) {
            return '(empty list or set)';
        }

        return result.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * ZLEXCOUNT key min max - Count members in lexicographical range
     * @param {Array<string>} args - Command arguments
     */
    zlexcount(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'zlexcount' command");
        }

        const [key, min, max] = args;
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const count = sortedSet.zlexcount(min, max);
        return `(integer) ${count}`;
    }

    /**
     * ZREMRANGEBYLEX key min max - Remove members by lexicographical range
     * @param {Array<string>} args - Command arguments
     */
    zremrangebylex(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'zremrangebylex' command");
        }

        const [key, min, max] = args;
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const removedCount = sortedSet.zremrangebylex(min, max);

        if (sortedSet.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * ZPOPMIN key [count] - Pop minimum scored members
     * @param {Array<string>} args - Command arguments
     */
    zpopmin(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'zpopmin' command");
        }

        const [key, countStr] = args;
        let count = 1;

        if (countStr !== undefined) {
            count = parseInt(countStr, 10);
            if (isNaN(count) || count < 0) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = sortedSet.zpopmin(count);

        // If sorted set becomes empty, remove the key
        if (sortedSet.isEmpty()) {
            this.deleteKey(key);
        }

        if (results.length === 0) {
            return '(empty list or set)';
        }

        return results.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * ZPOPMAX key [count] - Pop maximum scored members
     * @param {Array<string>} args - Command arguments
     */
    zpopmax(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'zpopmax' command");
        }

        const [key, countStr] = args;
        let count = 1;

        if (countStr !== undefined) {
            count = parseInt(countStr, 10);
            if (isNaN(count) || count < 0) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = sortedSet.zpopmax(count);

        // If sorted set becomes empty, remove the key
        if (sortedSet.isEmpty()) {
            this.deleteKey(key);
        }

        if (results.length === 0) {
            return '(empty list or set)';
        }

        return results.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * ZMSCORE key member [member ...] - Get scores for multiple members
     * @param {Array<string>} args - Command arguments
     */
    zmscore(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'zmscore' command");
        }

        const [key, ...members] = args;
        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return members.map(() => '(nil)').map((item, index) => `${index + 1}) ${item}`).join('\n');
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const scores = sortedSet.zmscore(...members);
        return scores.map((score, index) => `${index + 1}) ${score !== null ? `"${score}"` : '(nil)'}`).join('\n');
    }

    /**
     * ZRANDMEMBER key [count [WITHSCORES]] - Get random members from sorted set
     * @param {Array<string>} args - Command arguments
     */
    zrandmember(args) {
        if (args.length === 0 || args.length > 3) {
            throw new Error("ERR wrong number of arguments for 'zrandmember' command");
        }

        const [key, countStr, withScoresStr] = args;
        let count = 1;
        let withScores = false;

        if (countStr !== undefined) {
            count = parseInt(countStr, 10);
            if (isNaN(count)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        if (withScoresStr !== undefined) {
            if (withScoresStr.toUpperCase() === 'WITHSCORES') {
                withScores = true;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return args.length === 1 ? '(nil)' : '(empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const results = sortedSet.zrandmember(count, withScores);

        if (results.length === 0) {
            return args.length === 1 ? '(nil)' : '(empty list or set)';
        }

        if (args.length === 1) {
            // Single member, return as string
            return `"${results[0]}"`;
        } else {
            // Multiple members/values, return as array
            return results.map((item, index) => `${index + 1}) "${item}"`).join('\n');
        }
    }

    /**
     * ZSCAN key cursor [MATCH pattern] [COUNT count] - Incrementally iterate sorted set
     * @param {Array<string>} args - Command arguments
     */
    zscan(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'zscan' command");
        }

        const [key, cursorStr, ...options] = args;
        const cursor = parseInt(cursorStr, 10);
        
        if (isNaN(cursor) || cursor < 0) {
            throw new Error("ERR invalid cursor");
        }

        let pattern = '*';
        let count = 10;

        // Parse options
        for (let i = 0; i < options.length; i += 2) {
            const option = options[i];
            const value = options[i + 1];

            if (option.toUpperCase() === 'MATCH') {
                pattern = value;
            } else if (option.toUpperCase() === 'COUNT') {
                count = parseInt(value, 10);
                if (isNaN(count) || count < 1) {
                    throw new Error("ERR invalid count");
                }
            }
        }

        const sortedSet = this.getValue(key);

        if (sortedSet === undefined) {
            return '1) "0"\n2) (empty list or set)';
        }

        if (this.getType(key) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const [nextCursor, results] = sortedSet.zscan(cursor, pattern, count);
        
        let response = `1) "${nextCursor}"`;
        if (results.length === 0) {
            response += '\n2) (empty list or set)';
        } else {
            response += '\n2) ';
            response += results.map((item, index) => `${index + 1}) "${item}"`).join('\n   ');
        }
        
        return response;
    }

    /**
     * ZUNIONSTORE destination numkeys key [key ...] - Store union of multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    zunionstore(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zunionstore' command");
        }

        const [destination, numkeysStr, ...keys] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (keys.length < numkeys) {
            throw new Error("ERR wrong number of arguments for 'zunionstore' command");
        }

        const unionResult = new RedisSortedSet();
        const keyList = keys.slice(0, numkeys);

        // Union all sorted sets
        for (const key of keyList) {
            const sortedSet = this.getValue(key);
            if (sortedSet !== undefined && this.getType(key) === 'zset') {
                for (const item of sortedSet.sortedMembers) {
                    const existingScore = unionResult.scores.get(item.member);
                    const newScore = existingScore !== undefined ? existingScore + item.score : item.score;
                    
                    if (existingScore !== undefined) {
                        unionResult._removeFromSortedArray(item.member, existingScore);
                    }
                    unionResult.scores.set(item.member, newScore);
                    unionResult._insertIntoSortedArray(item.member, newScore);
                }
            }
        }

        if (unionResult.sortedMembers.length === 0) {
            // Remove destination key if it exists
            this.deleteKey(destination);
            return '(integer) 0';
        } else {
            this.setValue(destination, unionResult, 'zset');
            return `(integer) ${unionResult.sortedMembers.length}`;
        }
    }

    /**
     * ZINTERSTORE destination numkeys key [key ...] - Store intersection of multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    zinterstore(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zinterstore' command");
        }

        const [destination, numkeysStr, ...keys] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (keys.length < numkeys) {
            throw new Error("ERR wrong number of arguments for 'zinterstore' command");
        }

        const keyList = keys.slice(0, numkeys);
        const sortedSets = [];
        
        for (const key of keyList) {
            const set = this.getValue(key);
            if (set !== undefined && this.getType(key) === 'zset') {
                sortedSets.push(set);
            }
        }

        if (sortedSets.length === 0) {
            this.deleteKey(destination);
            return '(integer) 0';
        }

        const interResult = new RedisSortedSet();

        // Find intersection
        for (const item of sortedSets[0].sortedMembers) {
            let totalScore = item.score;
            let existsInAll = true;

            // Check if member exists in all other sets
            for (let i = 1; i < sortedSets.length; i++) {
                const score = sortedSets[i].scores.get(item.member);
                if (score === undefined) {
                    existsInAll = false;
                    break;
                }
                totalScore += score;
            }

            if (existsInAll) {
                interResult.scores.set(item.member, totalScore);
                interResult._insertIntoSortedArray(item.member, totalScore);
            }
        }

        if (interResult.sortedMembers.length === 0) {
            this.deleteKey(destination);
            return '(integer) 0';
        } else {
            this.setValue(destination, interResult, 'zset');
            return `(integer) ${interResult.sortedMembers.length}`;
        }
    }

    /**
     * ZUNION numkeys key [key ...] - Return union of multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    zunion(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'zunion' command");
        }

        const [numkeysStr, ...keys] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (keys.length < numkeys) {
            throw new Error("ERR wrong number of arguments for 'zunion' command");
        }

        const unionResult = new RedisSortedSet();
        const keyList = keys.slice(0, numkeys);

        // Union all sorted sets
        for (const key of keyList) {
            const sortedSet = this.getValue(key);
            if (sortedSet !== undefined && this.getType(key) === 'zset') {
                for (const item of sortedSet.sortedMembers) {
                    const existingScore = unionResult.scores.get(item.member);
                    const newScore = existingScore !== undefined ? existingScore + item.score : item.score;
                    
                    if (existingScore !== undefined) {
                        unionResult._removeFromSortedArray(item.member, existingScore);
                    }
                    unionResult.scores.set(item.member, newScore);
                    unionResult._insertIntoSortedArray(item.member, newScore);
                }
            }
        }

        if (unionResult.sortedMembers.length === 0) {
            return '(empty list or set)';
        }

        return unionResult.sortedMembers.map((item, index) => `${index + 1}) "${item.member}"`).join('\n');
    }

    /**
     * ZINTER numkeys key [key ...] - Return intersection of multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    zinter(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'zinter' command");
        }

        const [numkeysStr, ...keys] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (keys.length < numkeys) {
            throw new Error("ERR wrong number of arguments for 'zinter' command");
        }

        const keyList = keys.slice(0, numkeys);
        const sortedSets = [];
        
        for (const key of keyList) {
            const set = this.getValue(key);
            if (set !== undefined && this.getType(key) === 'zset') {
                sortedSets.push(set);
            }
        }

        if (sortedSets.length === 0) {
            return '(empty list or set)';
        }

        const interResult = [];

        // Find intersection
        for (const item of sortedSets[0].sortedMembers) {
            let existsInAll = true;

            // Check if member exists in all other sets
            for (let i = 1; i < sortedSets.length; i++) {
                if (!sortedSets[i].scores.has(item.member)) {
                    existsInAll = false;
                    break;
                }
            }

            if (existsInAll) {
                interResult.push(item.member);
            }
        }

        if (interResult.length === 0) {
            return '(empty list or set)';
        }

        return interResult.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * ZDIFF numkeys key [key ...] - Return difference of multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    zdiff(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'zdiff' command");
        }

        const [numkeysStr, ...keys] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (keys.length < numkeys) {
            throw new Error("ERR wrong number of arguments for 'zdiff' command");
        }

        const keyList = keys.slice(0, numkeys);
        const firstSet = this.getValue(keyList[0]);
        
        if (firstSet === undefined || this.getType(keyList[0]) !== 'zset') {
            return '(empty list or set)';
        }

        const diffResult = [];

        // Find difference (first set minus all others)
        for (const item of firstSet.sortedMembers) {
            let existsInOther = false;

            for (let i = 1; i < keyList.length; i++) {
                const otherSet = this.getValue(keyList[i]);
                if (otherSet !== undefined && this.getType(keyList[i]) === 'zset' && otherSet.scores.has(item.member)) {
                    existsInOther = true;
                    break;
                }
            }

            if (!existsInOther) {
                diffResult.push(item.member);
            }
        }

        if (diffResult.length === 0) {
            return '(empty list or set)';
        }

        return diffResult.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * ZDIFFSTORE destination numkeys key [key ...] - Store difference of multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    zdiffstore(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zdiffstore' command");
        }

        const [destination, numkeysStr, ...keys] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (keys.length < numkeys) {
            throw new Error("ERR wrong number of arguments for 'zdiffstore' command");
        }

        const keyList = keys.slice(0, numkeys);
        const firstSet = this.getValue(keyList[0]);
        
        if (firstSet === undefined || this.getType(keyList[0]) !== 'zset') {
            this.deleteKey(destination);
            return '(integer) 0';
        }

        const diffResult = new RedisSortedSet();

        // Find difference (first set minus all others)
        for (const item of firstSet.sortedMembers) {
            let existsInOther = false;

            for (let i = 1; i < keyList.length; i++) {
                const otherSet = this.getValue(keyList[i]);
                if (otherSet !== undefined && this.getType(keyList[i]) === 'zset' && otherSet.scores.has(item.member)) {
                    existsInOther = true;
                    break;
                }
            }

            if (!existsInOther) {
                diffResult.scores.set(item.member, item.score);
                diffResult._insertIntoSortedArray(item.member, item.score);
            }
        }

        if (diffResult.sortedMembers.length === 0) {
            this.deleteKey(destination);
            return '(integer) 0';
        } else {
            this.setValue(destination, diffResult, 'zset');
            return `(integer) ${diffResult.sortedMembers.length}`;
        }
    }

    /**
     * ZINTERCARD numkeys key [key ...] [LIMIT limit] - Get cardinality of intersection
     * @param {Array<string>} args - Command arguments
     */
    zintercard(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'zintercard' command");
        }

        const [numkeysStr, ...restArgs] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (restArgs.length < numkeys) {
            throw new Error("ERR wrong number of arguments for 'zintercard' command");
        }

        const keys = restArgs.slice(0, numkeys);
        let limit = -1;

        // Parse LIMIT option
        const limitIndex = restArgs.indexOf('LIMIT');
        if (limitIndex !== -1 && limitIndex + 1 < restArgs.length) {
            limit = parseInt(restArgs[limitIndex + 1], 10);
            if (isNaN(limit) || limit < 0) {
                throw new Error("ERR limit should be non-negative");
            }
        }

        const sortedSets = [];
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined && this.getType(key) === 'zset') {
                sortedSets.push(set);
            }
        }

        if (sortedSets.length === 0) {
            return '(integer) 0';
        }

        let intersectionCount = 0;

        // Find intersection count
        for (const item of sortedSets[0].sortedMembers) {
            let existsInAll = true;

            // Check if member exists in all other sets
            for (let i = 1; i < sortedSets.length; i++) {
                if (!sortedSets[i].scores.has(item.member)) {
                    existsInAll = false;
                    break;
                }
            }

            if (existsInAll) {
                intersectionCount++;
                if (limit !== -1 && intersectionCount >= limit) {
                    break;
                }
            }
        }

        return `(integer) ${intersectionCount}`;
    }

    /**
     * ZMPOP numkeys key [key ...] MIN|MAX [COUNT count] - Pop members from multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    zmpop(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'zmpop' command");
        }

        const [numkeysStr, ...restArgs] = args;
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (restArgs.length < numkeys + 1) {
            throw new Error("ERR wrong number of arguments for 'zmpop' command");
        }

        const keys = restArgs.slice(0, numkeys);
        const direction = restArgs[numkeys];
        let count = 1;

        if (direction.toUpperCase() !== 'MIN' && direction.toUpperCase() !== 'MAX') {
            throw new Error("ERR syntax error");
        }

        // Parse COUNT option
        const countIndex = restArgs.indexOf('COUNT');
        if (countIndex !== -1 && countIndex + 1 < restArgs.length) {
            count = parseInt(restArgs[countIndex + 1], 10);
            if (isNaN(count) || count <= 0) {
                throw new Error("ERR count should be greater than 0");
            }
        }

        // Find first non-empty sorted set
        for (const key of keys) {
            const sortedSet = this.getValue(key);
            if (sortedSet !== undefined && this.getType(key) === 'zset' && !sortedSet.isEmpty()) {
                const results = direction.toUpperCase() === 'MIN' ? 
                    sortedSet.zpopmin(count) : 
                    sortedSet.zpopmax(count);

                // If sorted set becomes empty, remove the key
                if (sortedSet.isEmpty()) {
                    this.deleteKey(key);
                }

                if (results.length === 0) {
                    continue;
                }

                let response = `1) "${key}"\n2) `;
                response += results.map((item, index) => `${index + 1}) "${item}"`).join('\n   ');
                return response;
            }
        }

        return '(nil)';
    }

    /**
     * ZRANGESTORE destination source start stop [BYSCORE|BYLEX] [REV] [LIMIT offset count]
     * @param {Array<string>} args - Command arguments
     */
    zrangestore(args) {
        if (args.length < 4) {
            throw new Error("ERR wrong number of arguments for 'zrangestore' command");
        }

        const [destination, source, startStr, stopStr, ...options] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const sortedSet = this.getValue(source);

        if (sortedSet === undefined) {
            this.deleteKey(destination);
            return '(integer) 0';
        }

        if (this.getType(source) !== 'zset') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // For simplicity, just implement basic range functionality
        const results = sortedSet.zrange(start, stop, false, false);

        if (results.length === 0) {
            this.deleteKey(destination);
            return '(integer) 0';
        }

        const destSortedSet = new RedisSortedSet();
        for (const member of results) {
            const score = sortedSet.scores.get(member);
            destSortedSet.scores.set(member, score);
            destSortedSet._insertIntoSortedArray(member, score);
        }

        this.setValue(destination, destSortedSet, 'zset');
        return `(integer) ${results.length}`;
    }

    /**
     * BZPOPMIN key [key ...] timeout - Blocking pop minimum
     * @param {Array<string>} args - Command arguments
     */
    bzpopmin(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'bzpopmin' command");
        }

        const timeout = parseFloat(args[args.length - 1]);
        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        const keys = args.slice(0, -1);

        // Check each key for available elements
        for (const key of keys) {
            const sortedSet = this.getValue(key);
            
            if (sortedSet === undefined) {
                continue;
            }

            if (this.getType(key) !== 'zset') {
                continue;
            }

            if (!sortedSet.isEmpty()) {
                const results = sortedSet.zpopmin(1);
                
                // If sorted set becomes empty, remove the key
                if (sortedSet.isEmpty()) {
                    this.deleteKey(key);
                }

                if (results.length >= 2) {
                    return `1) "${key}"\n2) "${results[0]}"\n3) "${results[1]}"`;
                }
            }
        }

        // For non-blocking behavior, just return nil
        // In a real implementation, this would block until timeout
        return '(nil)';
    }

    /**
     * BZPOPMAX key [key ...] timeout - Blocking pop maximum
     * @param {Array<string>} args - Command arguments
     */
    bzpopmax(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'bzpopmax' command");
        }

        const timeout = parseFloat(args[args.length - 1]);
        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        const keys = args.slice(0, -1);

        // Check each key for available elements
        for (const key of keys) {
            const sortedSet = this.getValue(key);
            
            if (sortedSet === undefined) {
                continue;
            }

            if (this.getType(key) !== 'zset') {
                continue;
            }

            if (!sortedSet.isEmpty()) {
                const results = sortedSet.zpopmax(1);
                
                // If sorted set becomes empty, remove the key
                if (sortedSet.isEmpty()) {
                    this.deleteKey(key);
                }

                if (results.length >= 2) {
                    return `1) "${key}"\n2) "${results[0]}"\n3) "${results[1]}"`;
                }
            }
        }

        // For non-blocking behavior, just return nil
        // In a real implementation, this would block until timeout
        return '(nil)';
    }

    /**
     * BZMPOP timeout numkeys key [key ...] MIN|MAX [COUNT count] - Blocking pop from multiple sorted sets
     * @param {Array<string>} args - Command arguments
     */
    bzmpop(args) {
        if (args.length < 4) {
            throw new Error("ERR wrong number of arguments for 'bzmpop' command");
        }

        const [timeoutStr, numkeysStr, ...restArgs] = args;
        const timeout = parseFloat(timeoutStr);
        const numkeys = parseInt(numkeysStr, 10);

        if (isNaN(timeout) || timeout < 0) {
            throw new Error("ERR timeout is not a float or out of range");
        }

        if (isNaN(numkeys) || numkeys <= 0) {
            throw new Error("ERR numkeys should be greater than 0");
        }

        if (restArgs.length < numkeys + 1) {
            throw new Error("ERR wrong number of arguments for 'bzmpop' command");
        }

        const keys = restArgs.slice(0, numkeys);
        const direction = restArgs[numkeys];
        let count = 1;

        if (direction.toUpperCase() !== 'MIN' && direction.toUpperCase() !== 'MAX') {
            throw new Error("ERR syntax error");
        }

        // Parse COUNT option
        const countIndex = restArgs.indexOf('COUNT');
        if (countIndex !== -1 && countIndex + 1 < restArgs.length) {
            count = parseInt(restArgs[countIndex + 1], 10);
            if (isNaN(count) || count <= 0) {
                throw new Error("ERR count should be greater than 0");
            }
        }

        // Find first non-empty sorted set
        for (const key of keys) {
            const sortedSet = this.getValue(key);
            if (sortedSet !== undefined && this.getType(key) === 'zset' && !sortedSet.isEmpty()) {
                const results = direction.toUpperCase() === 'MIN' ? 
                    sortedSet.zpopmin(count) : 
                    sortedSet.zpopmax(count);

                // If sorted set becomes empty, remove the key
                if (sortedSet.isEmpty()) {
                    this.deleteKey(key);
                }

                if (results.length === 0) {
                    continue;
                }

                let response = `1) "${key}"\n2) `;
                response += results.map((item, index) => `${index + 1}) "${item}"`).join('\n   ');
                return response;
            }
        }

        // For non-blocking behavior, just return nil
        // In a real implementation, this would block until timeout
        return '(nil)';
    }

    // ===== PHASE 7 COMMANDS - JSON OPERATIONS =====

    /**
     * JSON.GET key [path ...] [INDENT indent] [NEWLINE newline] [SPACE space] - Get JSON value at path
     * @param {Array<string>} args - Command arguments
     */
    jsonGet(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'json.get' command");
        }

        const [key, ...restArgs] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Parse paths and options
        const paths = [];
        let indent = null, newline = null, space = null;

        for (let i = 0; i < restArgs.length; i++) {
            const arg = restArgs[i].toUpperCase();
            if (arg === 'INDENT' && i + 1 < restArgs.length) {
                indent = restArgs[++i];
            } else if (arg === 'NEWLINE' && i + 1 < restArgs.length) {
                newline = restArgs[++i];
            } else if (arg === 'SPACE' && i + 1 < restArgs.length) {
                space = restArgs[++i];
            } else {
                paths.push(restArgs[i]);
            }
        }

        // Default to root path if no paths specified
        if (paths.length === 0) {
            paths.push('$');
        }

        const results = jsonObj.get(paths.length === 1 ? paths[0] : paths, indent, newline, space);
        
        if (results === null) {
            return '(nil)';
        }

        if (Array.isArray(results)) {
            return results.map((result, index) => `${index + 1}) ${result || '(nil)'}`).join('\n');
        }

        // If formatting options are provided, return unquoted formatted JSON
        if (indent || newline || space) {
            return results;
        }

        // Redis JSON wraps the array result in quotes
        return `"${results}"`;
    }

    /**
     * JSON.SET key path value [NX|XX] - Set JSON value at path
     * @param {Array<string>} args - Command arguments
     */
    jsonSet(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'json.set' command");
        }

        const [key, path, jsonValue, option] = args;

        // Parse option
        let optionStr = null;
        if (option) {
            if (option.toUpperCase() === 'NX' || option.toUpperCase() === 'XX') {
                optionStr = option.toUpperCase();
            } else {
                throw new Error("ERR syntax error");
            }
        }

        let jsonObj = this.getValue(key);

        // Create new JSON object if key doesn't exist
        if (jsonObj === undefined) {
            jsonObj = new RedisJSON();
            this.setValue(key, jsonObj, 'json');
        } else if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Set the value
        try {
            const success = jsonObj.set(path, jsonValue, optionStr);
            if (!success) {
                return '(nil)';
            }
            return 'OK';
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.DEL key [path] - Delete JSON value at path
     * @param {Array<string>} args - Command arguments
     */
    jsonDel(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.del' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const deletedCount = jsonObj.del(path);

        // If root was deleted or JSON is empty, remove the key
        if (jsonObj.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${deletedCount}`;
    }

    /**
     * JSON.TYPE key [path] - Get JSON type at path
     * @param {Array<string>} args - Command arguments
     */
    jsonType(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.type' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const type = jsonObj.type(path);
        return type ? `1) "${type}"` : '(nil)';
    }

    /**
     * JSON.STRLEN key [path] - Get string length at path
     * @param {Array<string>} args - Command arguments
     */
    jsonStrlen(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.strlen' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const length = jsonObj.strlen(path);
        return length !== null ? `1) (integer) ${length}` : '(nil)';
    }

    /**
     * JSON.MGET key [key ...] path - Get JSON values from multiple keys at path
     * @param {Array<string>} args - Command arguments
     */
    jsonMget(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'json.mget' command");
        }

        const path = args[args.length - 1];
        const keys = args.slice(0, -1);
        const results = [];

        for (const key of keys) {
            const jsonObj = this.getValue(key);

            if (jsonObj === undefined || this.getType(key) !== 'json') {
                results.push('(nil)');
            } else {
                const result = jsonObj.get(path);
                results.push(result !== null ? `"${result}"` : '(nil)');
            }
        }

        return results.map((result, index) => `${index + 1}) ${result}`).join('\n');
    }

    /**
     * JSON.ARRAPPEND key path value [value ...] - Append values to JSON array at path
     * @param {Array<string>} args - Command arguments
     */
    jsonArrappend(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'json.arrappend' command");
        }

        const [key, path, ...values] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            // Parse JSON values
            const parsedValues = values.map(v => {
                try {
                    return JSON.parse(v);
                } catch {
                    return v; // Keep as string if not valid JSON
                }
            });

            const newLength = jsonObj.arrappend(path, ...parsedValues);
            return `1) (integer) ${newLength}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.ARRLEN key [path] - Get JSON array length at path
     * @param {Array<string>} args - Command arguments
     */
    jsonArrlen(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.arrlen' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const length = jsonObj.arrlen(path);
        return length !== null ? `1) (integer) ${length}` : '(nil)';
    }

    /**
     * JSON.ARRINDEX key path value [start [stop]] - Find index of value in array
     * @param {Array<string>} args - Command arguments
     */
    jsonArrindex(args) {
        if (args.length < 3 || args.length > 5) {
            throw new Error("ERR wrong number of arguments for 'json.arrindex' command");
        }

        const [key, path, searchValue, startStr, stopStr] = args;
        const start = startStr ? parseInt(startStr, 10) : 0;
        const stop = stopStr ? parseInt(stopStr, 10) : -1;

        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            // Try to parse as JSON, but use as string if parsing fails
            let parsedValue;
            try {
                parsedValue = JSON.parse(searchValue);
            } catch {
                parsedValue = searchValue; // Use as string if not valid JSON
            }
            
            const index = jsonObj.arrindex(path, parsedValue, start, stop);
            return `(integer) ${index}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.ARRINSERT key path index value [value ...] - Insert values into array
     * @param {Array<string>} args - Command arguments
     */
    jsonArrinsert(args) {
        if (args.length < 4) {
            throw new Error("ERR wrong number of arguments for 'json.arrinsert' command");
        }

        const [key, path, indexStr, ...values] = args;
        const index = parseInt(indexStr, 10);

        if (isNaN(index)) {
            throw new Error("ERR index is not an integer");
        }

        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            // Parse JSON values
            const parsedValues = values.map(v => {
                try {
                    return JSON.parse(v);
                } catch {
                    return v; // Keep as string if not valid JSON
                }
            });

            const newLength = jsonObj.arrinsert(path, index, ...parsedValues);
            return `1) (integer) ${newLength}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.ARRPOP key path [index] - Pop value from JSON array
     * @param {Array<string>} args - Command arguments
     */
    jsonArrpop(args) {
        if (args.length < 2 || args.length > 3) {
            throw new Error("ERR wrong number of arguments for 'json.arrpop' command");
        }

        const [key, path, indexStr] = args;
        const index = indexStr ? parseInt(indexStr, 10) : -1;

        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            const poppedValue = jsonObj.arrpop(path, index);
            if (poppedValue !== null) {
                // Format the result as a JSON string with escaped quotes
                const jsonStr = JSON.stringify(poppedValue).replace(/"/g, '\\"');
                return `1) "${jsonStr}"`;
            }
            return '1) (nil)';
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.ARRTRIM key path start stop - Trim JSON array to range
     * @param {Array<string>} args - Command arguments
     */
    jsonArrtrim(args) {
        if (args.length !== 4) {
            throw new Error("ERR wrong number of arguments for 'json.arrtrim' command");
        }

        const [key, path, startStr, stopStr] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR start and stop must be integers");
        }

        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            const newLength = jsonObj.arrtrim(path, start, stop);
            return `1) (integer) ${newLength}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.OBJKEYS key [path] - Get JSON object keys at path
     * @param {Array<string>} args - Command arguments
     */
    jsonObjkeys(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.objkeys' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const keys = jsonObj.objkeys(path);
        if (keys === null) {
            return '(nil)';
        }

        return `1) ${keys.map((k, index) => `${index + 1}) "${k}"`).join('\n   ')}`;
    }

    /**
     * JSON.OBJLEN key [path] - Get JSON object length at path
     * @param {Array<string>} args - Command arguments
     */
    jsonObjlen(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.objlen' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const length = jsonObj.objlen(path);
        return length !== null ? `1) (integer) ${length}` : '(nil)';
    }

    /**
     * JSON.NUMINCRBY key path value - Increment number at JSON path
     * @param {Array<string>} args - Command arguments
     */
    jsonNumincrby(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'json.numincrby' command");
        }

        const [key, path, valueStr] = args;
        const value = parseFloat(valueStr);

        if (isNaN(value)) {
            throw new Error("ERR value is not a number");
        }

        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            const newValue = jsonObj.numincrby(path, value);
            return `"[${newValue}]"`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.NUMMULTBY key path value - Multiply number at JSON path
     * @param {Array<string>} args - Command arguments
     */
    jsonNummultby(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'json.nummultby' command");
        }

        const [key, path, valueStr] = args;
        const value = parseFloat(valueStr);

        if (isNaN(value)) {
            throw new Error("ERR value is not a number");
        }

        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            const newValue = jsonObj.nummultby(path, value);
            return `"[${newValue}]"`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.CLEAR key [path] - Clear JSON value at path
     * @param {Array<string>} args - Command arguments
     */
    jsonClear(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.clear' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const clearedCount = jsonObj.clear(path);
        return `(integer) ${clearedCount}`;
    }

    /**
     * JSON.FORGET key [path] - Alias for JSON.DEL
     * @param {Array<string>} args - Command arguments
     */
    jsonForget(args) {
        return this.jsonDel(args);
    }

    /**
     * JSON.RESP key [path] - Get JSON value in RESP format
     * @param {Array<string>} args - Command arguments
     */
    jsonResp(args) {
        if (args.length === 0 || args.length > 2) {
            throw new Error("ERR wrong number of arguments for 'json.resp' command");
        }

        const [key, path = '$'] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const result = jsonObj._getAtPath(path);
        if (result === undefined) {
            return '(nil)';
        }

        // Return in RESP format (simplified)
        return this._convertToRESP(result);
    }

    /**
     * JSON.DEBUG subcommand [key] [path] - Debug JSON operations
     * @param {Array<string>} args - Command arguments
     */
    jsonDebug(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'json.debug' command");
        }

        const [subcommand, key, path = '$'] = args;

        switch (subcommand.toUpperCase()) {
            case 'MEMORY':
                if (!key) {
                    throw new Error("ERR wrong number of arguments for 'json.debug' command");
                }

                const jsonObj = this.getValue(key);
                if (jsonObj === undefined) {
                    return '(integer) 0';
                }

                if (this.getType(key) !== 'json') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }

                return `(integer) ${jsonObj.size()}`;

            case 'HELP':
                return 'JSON.DEBUG MEMORY key [path] - Show memory usage\nJSON.DEBUG HELP - Show debug help';

            default:
                throw new Error("ERR unknown subcommand");
        }
    }

    /**
     * Convert value to RESP format (simplified)
     * @param {*} value - Value to convert
     * @returns {string} - RESP formatted string
     * @private
     */
    _convertToRESP(value) {
        if (value === null) return '$-1';
        if (typeof value === 'string') return `$${value.length}\r\n${value}`;
        if (typeof value === 'number') return `:${value}`;
        if (typeof value === 'boolean') return value ? ':1' : ':0';
        if (Array.isArray(value)) {
            return `*${value.length}\r\n` + value.map(v => this._convertToRESP(v)).join('\r\n');
        }
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            return `*${keys.length * 2}\r\n` + keys.map(k => 
                `$${k.length}\r\n${k}\r\n${this._convertToRESP(value[k])}`
            ).join('\r\n');
        }
        return `$${String(value).length}\r\n${String(value)}`;
    }

    /**
     * JSON.MSET key path value [key path value ...] - Set multiple JSON keys at once
     * @param {Array<string>} args - Command arguments
     */
    jsonMset(args) {
        if (args.length < 3 || args.length % 3 !== 0) {
            throw new Error("ERR wrong number of arguments for 'json.mset' command");
        }

        // Process in groups of 3: key, path, value
        const operations = [];
        for (let i = 0; i < args.length; i += 3) {
            const [key, path, jsonValue] = args.slice(i, i + 3);
            operations.push({ key, path, jsonValue });
        }

        // Execute all operations
        for (const { key, path, jsonValue } of operations) {
            let jsonObj = this.getValue(key);

            // Create new JSON object if key doesn't exist
            if (jsonObj === undefined) {
                jsonObj = new RedisJSON();
                this.setValue(key, jsonObj, 'json');
            } else if (this.getType(key) !== 'json') {
                throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
            }

            // Set the value
            jsonObj.set(path, jsonValue);
        }

        return 'OK';
    }

    /**
     * JSON.MERGE key path value - Merge JSON value into existing paths
     * @param {Array<string>} args - Command arguments
     */
    jsonMerge(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'json.merge' command");
        }

        const [key, path, jsonValue] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            const result = jsonObj.merge(path, jsonValue);
            return result;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.STRAPPEND key path value - Append to string at JSON path
     * @param {Array<string>} args - Command arguments
     */
    jsonStrappend(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'json.strappend' command");
        }

        const [key, path, value] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            const newLength = jsonObj.strappend(path, value);
            return `1) (integer) ${newLength}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * JSON.TOGGLE key path - Toggle boolean value at JSON path
     * @param {Array<string>} args - Command arguments
     */
    jsonToggle(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'json.toggle' command");
        }

        const [key, path] = args;
        const jsonObj = this.getValue(key);

        if (jsonObj === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'json') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        try {
            const newValue = jsonObj.toggle(path);
            return `(integer) ${newValue}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    // ============================================================================
    // Phase 8: Transaction Support
    // ============================================================================

    /**
     * MULTI - Start a transaction
     * @param {Array<string>} args - Command arguments
     */
    multi(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'multi' command");
        }

        if (this.inTransaction) {
            throw new Error("ERR MULTI calls can not be nested");
        }

        this.inTransaction = true;
        this.transactionQueue = [];
        return 'OK';
    }

    /**
     * EXEC - Execute all commands in the transaction
     * @param {Array<string>} args - Command arguments
     */
    exec(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'exec' command");
        }

        if (!this.inTransaction) {
            throw new Error("ERR EXEC without MULTI");
        }

        // Check if any watched keys have been modified
        if (this.hasWatchedKeysChanged()) {
            this.discardTransaction();
            return '(nil)';
        }

        // Execute all queued commands atomically
        const results = [];
        const queuedCommands = [...this.transactionQueue];

        // Reset transaction state before execution
        this.inTransaction = false;
        this.transactionQueue = [];
        this.clearWatchedKeys();

        for (const { command, args: commandArgs } of queuedCommands) {
            try {
                // Execute the command directly by calling the appropriate method
                const result = this.executeCommand(command, commandArgs);
                results.push(result);
            } catch (error) {
                results.push(`(error) ${error.message}`);
            }
        }

        return results.map((result, index) => `${index + 1}) ${result}`).join('\n');
    }

    /**
     * DISCARD - Discard the transaction
     * @param {Array<string>} args - Command arguments
     */
    discard(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'discard' command");
        }

        if (!this.inTransaction) {
            throw new Error("ERR DISCARD without MULTI");
        }

        this.discardTransaction();
        return 'OK';
    }

    /**
     * WATCH key [key ...] - Watch keys for changes
     * @param {Array<string>} args - Command arguments
     */
    watch(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'watch' command");
        }

        if (this.inTransaction) {
            throw new Error("ERR WATCH inside MULTI is not allowed");
        }

        for (const key of args) {
            this.watchedKeys.add(key);
            // Store current value (or lack thereof) for later comparison
            const value = this.getValue(key);
            this.watchedKeyValues.set(key, value === undefined ? Symbol('undefined') : value);
        }

        return 'OK';
    }

    /**
     * UNWATCH - Stop watching all keys
     * @param {Array<string>} args - Command arguments
     */
    unwatch(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'unwatch' command");
        }

        this.clearWatchedKeys();
        return 'OK';
    }

    /**
     * Helper method to execute a single command
     * @param {string} command - Command name
     * @param {Array<string>} args - Command arguments
     * @param {boolean} logToAof - Whether to log this command to AOF (default: true)
     * @returns {*} - Command result
     */
    executeCommand(command, args, logToAof = true) {
        // Log write commands to AOF before execution (unless disabled)
        if (logToAof && this.isWriteCommand(command)) {
            this.logToAOF(command, args);
            // Increment RDB changes counter for auto-save
            if (this.rdbEnabled) {
                this.rdbChangesSinceLastSave++;
            }
        }
        
        switch (command) {
            // Phase 1 commands
            case 'SET': return this.set(args);
            case 'GET': return this.get(args);
            case 'DEL': return this.del(args);
            case 'EXISTS': return this.exists(args);
            case 'KEYS': return this.keys(args);
            case 'FLUSHALL': return this.flushall();
            case 'MSET': return this.mset(args);
            case 'MGET': return this.mget(args);
            case 'GETSET': return this.getset(args);
            case 'SETNX': return this.setnx(args);
            case 'GETRANGE': return this.getrange(args);
            case 'SETRANGE': return this.setrange(args);
            case 'DBSIZE': return this.dbsize(args);
            case 'RANDOMKEY': return this.randomkey(args);

            // Phase 2 commands
            case 'APPEND': return this.append(args);
            case 'STRLEN': return this.strlen(args);
            case 'INCR': return this.incr(args);
            case 'DECR': return this.decr(args);
            case 'INCRBY': return this.incrby(args);
            case 'DECRBY': return this.decrby(args);
            case 'INCRBYFLOAT': return this.incrbyfloat(args);
            case 'MSETNX': return this.msetnx(args);
            case 'GETDEL': return this.getdel(args);
            case 'LCS': return this.lcs(args);
            case 'EXPIRE': return this.expire(args);
            case 'PEXPIRE': return this.pexpire(args);
            case 'TTL': return this.ttl(args);
            case 'PTTL': return this.pttl(args);
            case 'PERSIST': return this.persist(args);
            case 'RENAME': return this.rename(args);
            case 'RENAMENX': return this.renamenx(args);
            case 'EXPIREAT': return this.expireat(args);
            case 'PEXPIREAT': return this.pexpireat(args);
            case 'SETEX': return this.setex(args);
            case 'PSETEX': return this.psetex(args);
            case 'GETEX': return this.getex(args);
            case 'TYPE': return this.type(args);

            // Phase 3 commands (Lists)
            case 'LPUSH': return this.lpush(args);
            case 'RPUSH': return this.rpush(args);
            case 'LPOP': return this.lpop(args);
            case 'RPOP': return this.rpop(args);
            case 'LLEN': return this.llen(args);
            case 'LRANGE': return this.lrange(args);
            case 'LINDEX': return this.lindex(args);
            case 'LSET': return this.lset(args);
            case 'LTRIM': return this.ltrim(args);
            case 'LINSERT': return this.linsert(args);
            case 'LPUSHX': return this.lpushx(args);
            case 'RPUSHX': return this.rpushx(args);
            case 'LREM': return this.lrem(args);
            case 'RPOPLPUSH': return this.rpoplpush(args);
            case 'LMOVE': return this.lmove(args);
            case 'LPOS': return this.lpos(args);
            case 'LMPOP': return this.lmpop(args);
            case 'BLPOP': return this.blpop(args);
            case 'BRPOP': return this.brpop(args);
            case 'BRPOPLPUSH': return this.brpoplpush(args);
            case 'BLMOVE': return this.blmove(args);
            case 'BLMPOP': return this.blmpop(args);

            // Phase 4 commands (Sets)
            case 'SADD': return this.sadd(args);
            case 'SREM': return this.srem(args);
            case 'SMEMBERS': return this.smembers(args);
            case 'SCARD': return this.scard(args);
            case 'SISMEMBER': return this.sismember(args);
            case 'SUNION': return this.sunion(args);
            case 'SINTER': return this.sinter(args);
            case 'SDIFF': return this.sdiff(args);
            case 'SPOP': return this.spop(args);
            case 'SRANDMEMBER': return this.srandmember(args);
            case 'SMOVE': return this.smove(args);
            case 'SUNIONSTORE': return this.sunionstore(args);
            case 'SINTERSTORE': return this.sinterstore(args);
            case 'SDIFFSTORE': return this.sdiffstore(args);
            case 'SINTERCARD': return this.sintercard(args);
            case 'SMISMEMBER': return this.smismember(args);
            case 'SSCAN': return this.sscan(args);

            // Phase 5 commands (Hashes)
            case 'HSET': return this.hset(args);
            case 'HGET': return this.hget(args);
            case 'HMGET': return this.hmget(args);
            case 'HGETALL': return this.hgetall(args);
            case 'HDEL': return this.hdel(args);
            case 'HEXISTS': return this.hexists(args);
            case 'HKEYS': return this.hkeys(args);
            case 'HVALS': return this.hvals(args);
            case 'HLEN': return this.hlen(args);
            case 'HINCRBY': return this.hincrby(args);
            case 'HINCRBYFLOAT': return this.hincrbyfloat(args);
            case 'HSETNX': return this.hsetnx(args);
            case 'HMSET': return this.hmset(args);
            case 'HSTRLEN': return this.hstrlen(args);
            case 'HSCAN': return this.hscan(args);
            case 'HRANDFIELD': return this.hrandfield(args);
            case 'HGETDEL': return this.hgetdel(args);
            case 'HEXPIRE': return this.hexpire(args);
            case 'HEXPIREAT': return this.hexpireat(args);
            case 'HEXPIRETIME': return this.hexpiretime(args);
            case 'HPEXPIRE': return this.hpexpire(args);
            case 'HPEXPIREAT': return this.hpexpireat(args);
            case 'HPEXPIRETIME': return this.hpexpiretime(args);
            case 'HTTL': return this.httl(args);
            case 'HPTTL': return this.hpttl(args);
            case 'HPERSIST': return this.hpersist(args);

            // Phase 6 commands (Sorted Sets)
            case 'ZADD': return this.zadd(args);
            case 'ZREM': return this.zrem(args);
            case 'ZSCORE': return this.zscore(args);
            case 'ZRANK': return this.zrank(args);
            case 'ZREVRANK': return this.zrevrank(args);
            case 'ZRANGE': return this.zrange(args);
            case 'ZREVRANGE': return this.zrevrange(args);
            case 'ZRANGEBYSCORE': return this.zrangebyscore(args);
            case 'ZREVRANGEBYSCORE': return this.zrevrangebyscore(args);
            case 'ZCOUNT': return this.zcount(args);
            case 'ZCARD': return this.zcard(args);
            case 'ZINCRBY': return this.zincrby(args);
            case 'ZREMRANGEBYRANK': return this.zremrangebyrank(args);
            case 'ZREMRANGEBYSCORE': return this.zremrangebyscore(args);
            case 'ZRANGEBYLEX': return this.zrangebylex(args);
            case 'ZREVRANGEBYLEX': return this.zrevrangebylex(args);
            case 'ZLEXCOUNT': return this.zlexcount(args);
            case 'ZREMRANGEBYLEX': return this.zremrangebylex(args);
            case 'ZPOPMIN': return this.zpopmin(args);
            case 'ZPOPMAX': return this.zpopmax(args);
            case 'ZMSCORE': return this.zmscore(args);
            case 'ZRANDMEMBER': return this.zrandmember(args);
            case 'ZSCAN': return this.zscan(args);
            case 'ZUNIONSTORE': return this.zunionstore(args);
            case 'ZINTERSTORE': return this.zinterstore(args);
            case 'ZUNION': return this.zunion(args);
            case 'ZINTER': return this.zinter(args);
            case 'ZDIFF': return this.zdiff(args);
            case 'ZDIFFSTORE': return this.zdiffstore(args);
            case 'ZINTERCARD': return this.zintercard(args);
            case 'ZMPOP': return this.zmpop(args);
            case 'ZRANGESTORE': return this.zrangestore(args);
            case 'BZPOPMIN': return this.bzpopmin(args);
            case 'BZPOPMAX': return this.bzpopmax(args);
            case 'BZMPOP': return this.bzmpop(args);

            // Phase 7 commands (JSON)
            case 'JSON.GET': return this.jsonGet(args);
            case 'JSON.SET': return this.jsonSet(args);
            case 'JSON.DEL': return this.jsonDel(args);
            case 'JSON.TYPE': return this.jsonType(args);
            case 'JSON.STRLEN': return this.jsonStrlen(args);
            case 'JSON.MGET': return this.jsonMget(args);
            case 'JSON.ARRAPPEND': return this.jsonArrappend(args);
            case 'JSON.ARRLEN': return this.jsonArrlen(args);
            case 'JSON.ARRINDEX': return this.jsonArrindex(args);
            case 'JSON.ARRINSERT': return this.jsonArrinsert(args);
            case 'JSON.ARRPOP': return this.jsonArrpop(args);
            case 'JSON.ARRTRIM': return this.jsonArrtrim(args);
            case 'JSON.OBJKEYS': return this.jsonObjkeys(args);
            case 'JSON.OBJLEN': return this.jsonObjlen(args);
            case 'JSON.NUMINCRBY': return this.jsonNumincrby(args);
            case 'JSON.NUMMULTBY': return this.jsonNummultby(args);
            case 'JSON.CLEAR': return this.jsonClear(args);
            case 'JSON.FORGET': return this.jsonForget(args);
            case 'JSON.RESP': return this.jsonResp(args);
            case 'JSON.DEBUG': return this.jsonDebug(args);
            case 'JSON.MSET': return this.jsonMset(args);
            case 'JSON.MERGE': return this.jsonMerge(args);
            case 'JSON.STRAPPEND': return this.jsonStrappend(args);
            case 'JSON.TOGGLE': return this.jsonToggle(args);

            // Phase 10 commands (AOF Persistence)
            case 'BGREWRITEAOF': return this.bgrewriteaof(args);

            // Phase 11 commands (RDB Snapshots)
            case 'SAVE': return this.save(args);
            case 'BGSAVE': return this.bgsave(args);
            case 'LASTSAVE': return this.lastsave(args);

            // Phase 12 commands (Geospatial Data)
            case 'GEOADD': return this.geoadd(args);
            case 'GEODIST': return this.geodist(args);
            case 'GEOPOS': return this.geopos(args);
            case 'GEOHASH': return this.geohash(args);
            case 'GEORADIUS': return this.georadius(args);
            case 'GEORADIUSBYMEMBER': return this.georadiusbymember(args);
            case 'GEOSEARCH': return this.geosearch(args);
            case 'GEOSEARCHSTORE': return this.geosearchstore(args);

            // Phase 13 commands (Bitmaps & Bitfields)
            case 'SETBIT': return this.setbit(args);
            case 'GETBIT': return this.getbit(args);
            case 'BITCOUNT': return this.bitcount(args);
            case 'BITPOS': return this.bitpos(args);
            case 'BITOP': return this.bitop(args);
            case 'BITFIELD': return this.bitfield(args);
            case 'BITFIELD_RO': return this.bitfieldRo(args);

            // Phase 14 commands (Streams)
            case 'XADD': return this.xadd(args);
            case 'XREAD': return this.xread(args);
            case 'XRANGE': return this.xrange(args);
            case 'XREVRANGE': return this.xrevrange(args);
            case 'XLEN': return this.xlen(args);
            case 'XTRIM': return this.xtrim(args);
            case 'XDEL': return this.xdel(args);
            case 'XGROUP': return this.xgroup(args);
            case 'XREADGROUP': return this.xreadgroup(args);
            case 'XACK': return this.xack(args);
            case 'XPENDING': return this.xpending(args);
            case 'XCLAIM': return this.xclaim(args);
            case 'XINFO': return this.xinfo(args);
            case 'XSETID': return this.xsetid(args);
            case 'XAUTOCLAIM': return this.xautoclaim(args);

            default:
                throw new Error(`ERR unknown command '${command.toLowerCase()}'`);
        }
    }

    /**
     * Helper method to check if watched keys have changed
     * @returns {boolean} - True if any watched key has changed
     */
    hasWatchedKeysChanged() {
        for (const key of this.watchedKeys) {
            const currentValue = this.getValue(key);
            const watchedValue = this.watchedKeyValues.get(key);
            
            // Compare values (handle undefined case with Symbol)
            const currentIsUndefined = currentValue === undefined;
            const watchedIsUndefined = watchedValue === Symbol('undefined');
            
            if (currentIsUndefined !== watchedIsUndefined) {
                return true; // Key existence changed
            }
            
            if (!currentIsUndefined && currentValue !== watchedValue) {
                return true; // Key value changed
            }
        }
        return false;
    }

    /**
     * Helper method to discard transaction and clear state
     */
    discardTransaction() {
        this.inTransaction = false;
        this.transactionQueue = [];
        this.clearWatchedKeys();
    }

    /**
     * Helper method to clear watched keys
     */
    clearWatchedKeys() {
        this.watchedKeys.clear();
        this.watchedKeyValues.clear();
    }

    // ============================================================================
    // Phase 10: AOF (Append Only File) Persistence
    // ============================================================================

    /**
     * Load data from AOF file if it exists
     */
    loadFromAOF() {
        try {
            if (!fs.existsSync(this.aofFilename)) {
                console.log(`AOF enabled but no AOF file found at ${this.aofFilename}`);
                return;
            }

            const aofContent = fs.readFileSync(this.aofFilename, 'utf8');
            if (!aofContent.trim()) {
                console.log('AOF file is empty');
                return;
            }

            const commands = aofContent.trim().split('\n');
            let loadedCommands = 0;

            console.log(`Loading data from AOF file: ${this.aofFilename}`);

            for (const line of commands) {
                if (!line.trim()) continue;

                try {
                    const commandData = JSON.parse(line);
                    const { command, args, timestamp } = commandData;

                    // Replay the command without logging it again to AOF
                    this.executeCommand(command, args, false);
                    loadedCommands++;
                } catch (parseError) {
                    console.warn(`Warning: Failed to parse AOF line: ${line}`, parseError.message);
                }
            }

            console.log(`AOF loading complete. ${loadedCommands} commands loaded.`);
        } catch (error) {
            console.error(`Error loading AOF file: ${error.message}`);
        }
    }

    /**
     * Log a command to the AOF file
     * @param {string} command - Command name
     * @param {Array<string>} args - Command arguments
     */
    logToAOF(command, args) {
        if (!this.aofEnabled) return;

        const commandData = {
            command: command,
            args: args,
            timestamp: Date.now()
        };

        this.aofBuffer.push(JSON.stringify(commandData) + '\n');

        // Sync based on policy
        switch (this.aofSyncPolicy) {
            case 'always':
                this.syncAOF();
                break;
            case 'everysec':
                if (Date.now() - this.aofLastSyncTime >= 1000) {
                    this.syncAOF();
                }
                break;
            case 'no':
                // Let OS decide when to sync
                break;
        }
    }

    /**
     * Sync AOF buffer to disk
     */
    syncAOF() {
        if (this.aofBuffer.length === 0) return;

        try {
            const content = this.aofBuffer.join('');
            fs.appendFileSync(this.aofFilename, content);
            this.aofBuffer = [];
            this.aofLastSyncTime = Date.now();
        } catch (error) {
            console.error(`Error syncing AOF: ${error.message}`);
        }
    }

    /**
     * Start background AOF sync timer for 'everysec' policy
     */
    startAOFSyncTimer() {
        if (this.aofSyncPolicy === 'everysec') {
            setInterval(() => {
                if (this.aofBuffer.length > 0) {
                    this.syncAOF();
                }
            }, 1000); // Sync every second
        }
    }

    /**
     * BGREWRITEAOF - Rewrite AOF file to compact it
     * @param {Array<string>} args - Command arguments
     */
    bgrewriteaof(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'bgrewriteaof' command");
        }

        if (!this.aofEnabled) {
            throw new Error("ERR AOF is not enabled");
        }

        if (this.aofRewriteInProgress) {
            throw new Error("ERR Background AOF rewrite already in progress");
        }

        try {
            this.aofRewriteInProgress = true;

            // Sync current buffer first
            this.syncAOF();

            // Create a backup of current AOF
            const backupFilename = `${this.aofFilename}.backup.${Date.now()}`;
            if (fs.existsSync(this.aofFilename)) {
                fs.copyFileSync(this.aofFilename, backupFilename);
            }

            // Generate new AOF file with current state
            const newAofFilename = `${this.aofFilename}.tmp`;
            const commands = [];

            // Generate commands to recreate current state
            for (const [key, value] of this.store.entries()) {
                const type = this.getType(key);
                
                switch (type) {
                    case 'string':
                        commands.push(this.generateSetCommand(key, value));
                        break;
                    case 'list':
                        commands.push(...this.generateListCommands(key, value));
                        break;
                    case 'set':
                        commands.push(...this.generateSetCommands(key, value));
                        break;
                    case 'hash':
                        commands.push(...this.generateHashCommands(key, value));
                        break;
                    case 'zset':
                        commands.push(...this.generateZSetCommands(key, value));
                        break;
                    case 'json':
                        commands.push(this.generateJsonCommand(key, value));
                        break;
                }

                // Add expiration if set
                if (this.expiration.has(key)) {
                    const expireTime = this.expiration.get(key);
                    commands.push({
                        command: 'PEXPIREAT',
                        args: [key, expireTime.toString()],
                        timestamp: Date.now()
                    });
                }
            }

            // Write new AOF file
            const content = commands.map(cmd => JSON.stringify(cmd) + '\n').join('');
            fs.writeFileSync(newAofFilename, content);

            // Replace old AOF with new one
            if (fs.existsSync(this.aofFilename)) {
                fs.unlinkSync(this.aofFilename);
            }
            fs.renameSync(newAofFilename, this.aofFilename);

            // Clean up backup after successful rewrite
            setTimeout(() => {
                try {
                    if (fs.existsSync(backupFilename)) {
                        fs.unlinkSync(backupFilename);
                    }
                } catch (e) {
                    console.warn(`Warning: Could not clean up backup file: ${e.message}`);
                }
            }, 5000);

            this.aofRewriteInProgress = false;
            return 'Background AOF rewrite started';

        } catch (error) {
            this.aofRewriteInProgress = false;
            throw new Error(`ERR AOF rewrite failed: ${error.message}`);
        }
    }

    /**
     * Generate SET command for AOF rewrite
     */
    generateSetCommand(key, value) {
        return {
            command: 'SET',
            args: [key, value],
            timestamp: Date.now()
        };
    }

    /**
     * Generate list commands for AOF rewrite
     */
    generateListCommands(key, list) {
        const commands = [];
        const array = list.toArray();
        
        if (array.length > 0) {
            commands.push({
                command: 'RPUSH',
                args: [key, ...array],
                timestamp: Date.now()
            });
        }
        
        return commands;
    }

    /**
     * Generate set commands for AOF rewrite
     */
    generateSetCommands(key, set) {
        const commands = [];
        const members = set.toArray();
        
        if (members.length > 0) {
            commands.push({
                command: 'SADD',
                args: [key, ...members],
                timestamp: Date.now()
            });
        }
        
        return commands;
    }

    /**
     * Generate hash commands for AOF rewrite
     */
    generateHashCommands(key, hash) {
        const commands = [];
        const fields = [];
        
        for (const [field, value] of hash.fields.entries()) {
            if (!hash.isFieldExpired(field)) {
                fields.push(field, value);
            }
        }
        
        if (fields.length > 0) {
            commands.push({
                command: 'HSET',
                args: [key, ...fields],
                timestamp: Date.now()
            });
        }
        
        // Add field expirations
        for (const [field, expireTime] of hash.fieldExpirations.entries()) {
            commands.push({
                command: 'HPEXPIREAT',
                args: [key, expireTime.toString(), field],
                timestamp: Date.now()
            });
        }
        
        return commands;
    }

    /**
     * Generate sorted set commands for AOF rewrite
     */
    generateZSetCommands(key, zset) {
        const commands = [];
        const scoreMembers = [];
        
        for (const { member, score } of zset.toArray()) {
            scoreMembers.push(score, member);
        }
        
        if (scoreMembers.length > 0) {
            commands.push({
                command: 'ZADD',
                args: [key, ...scoreMembers],
                timestamp: Date.now()
            });
        }
        
        return commands;
    }

    /**
     * Generate JSON command for AOF rewrite
     */
    generateJsonCommand(key, json) {
        return {
            command: 'JSON.SET',
            args: [key, '$', JSON.stringify(json.data)],
            timestamp: Date.now()
        };
    }

    /**
     * Check if a command should be logged to AOF
     * @param {string} command - Command name
     * @returns {boolean} - True if command should be logged
     */
    isWriteCommand(command) {
        const writeCommands = new Set([
            // String commands
            'SET', 'MSET', 'SETNX', 'SETEX', 'PSETEX', 'APPEND', 'SETRANGE', 'INCR', 'DECR', 
            'INCRBY', 'DECRBY', 'INCRBYFLOAT', 'GETSET', 'MSETNX', 'GETDEL',
            
            // Key management
            'DEL', 'EXPIRE', 'PEXPIRE', 'EXPIREAT', 'PEXPIREAT', 'PERSIST', 'RENAME', 'RENAMENX',
            'FLUSHALL',
            
            // List commands
            'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LSET', 'LTRIM', 'LINSERT', 'LPUSHX', 'RPUSHX',
            'LREM', 'RPOPLPUSH', 'LMOVE', 'LMPOP',
            
            // Set commands
            'SADD', 'SREM', 'SPOP', 'SMOVE', 'SUNIONSTORE', 'SINTERSTORE', 'SDIFFSTORE',
            
            // Hash commands
            'HSET', 'HDEL', 'HINCRBY', 'HINCRBYFLOAT', 'HSETNX', 'HMSET', 'HGETDEL',
            'HEXPIRE', 'HEXPIREAT', 'HPEXPIRE', 'HPEXPIREAT', 'HPERSIST',
            
            // Sorted set commands
            'ZADD', 'ZREM', 'ZINCRBY', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE', 'ZREMRANGEBYLEX',
            'ZPOPMIN', 'ZPOPMAX', 'ZUNIONSTORE', 'ZINTERSTORE', 'ZDIFFSTORE', 'ZMPOP', 'ZRANGESTORE',
            
            // JSON commands
            'JSON.SET', 'JSON.DEL', 'JSON.ARRAPPEND', 'JSON.ARRINSERT', 'JSON.ARRPOP', 'JSON.ARRTRIM',
            'JSON.NUMINCRBY', 'JSON.NUMMULTBY', 'JSON.STRAPPEND', 'JSON.TOGGLE', 'JSON.CLEAR',
            'JSON.MSET', 'JSON.MERGE',
            
            // Geospatial commands
            'GEOADD', 'GEOSEARCHSTORE',
            
            // Bitmap commands
            'SETBIT', 'BITOP', 'BITFIELD',
            
            // Stream commands
            'XADD', 'XTRIM', 'XDEL', 'XSETID', 'XGROUP', 'XACK', 'XCLAIM', 'XAUTOCLAIM'
        ]);
        
        return writeCommands.has(command);
    }

    // ============================================================================
    // Phase 11: RDB (Redis Database) Snapshots
    // ============================================================================

    /**
     * Load data from RDB file if it exists
     */
    loadFromRDB() {
        try {
            if (!fs.existsSync(this.rdbFilename)) {
                console.log(`RDB enabled but no RDB file found at ${this.rdbFilename}`);
                return;
            }

            const rdbContent = fs.readFileSync(this.rdbFilename, 'utf8');
            if (!rdbContent.trim()) {
                console.log('RDB file is empty');
                return;
            }

            console.log(`Loading data from RDB file: ${this.rdbFilename}`);

            const snapshot = JSON.parse(rdbContent);
            const { timestamp, data, expirations, version } = snapshot;

            // Validate RDB format
            if (!data || !timestamp) {
                throw new Error('Invalid RDB file format');
            }

            console.log(`RDB snapshot from ${new Date(timestamp).toISOString()}`);

            // Restore data
            let loadedKeys = 0;
            for (const [key, value] of Object.entries(data)) {
                // Restore the actual data structure
                this.data.set(key, this.deserializeValue(value));
                loadedKeys++;
            }

            // Restore expirations
            if (expirations) {
                for (const [key, expireTime] of Object.entries(expirations)) {
                    if (expireTime > Date.now()) {
                        this.expiration.set(key, expireTime);
                    }
                }
            }

            this.rdbLastSaveTime = timestamp;
            this.rdbChangesSinceLastSave = 0;

            console.log(`RDB loading complete. ${loadedKeys} keys loaded.`);
        } catch (error) {
            console.error(`Error loading RDB file: ${error.message}`);
        }
    }

    /**
     * Start RDB auto-save timer
     */
    startRDBAutoSaveTimer() {
        setInterval(() => {
            if (this.rdbChangesSinceLastSave >= this.rdbSaveChanges) {
                const timeSinceLastSave = (Date.now() - this.rdbLastSaveTime) / 1000;
                if (timeSinceLastSave >= this.rdbSaveSeconds) {
                    console.log(`Auto-saving RDB: ${this.rdbChangesSinceLastSave} changes in ${Math.round(timeSinceLastSave)}s`);
                    try {
                        this.createRDBSnapshot();
                        console.log('Auto-save completed');
                    } catch (error) {
                        console.error(`Auto-save failed: ${error.message}`);
                    }
                }
            }
        }, 1000); // Check every second
    }

    /**
     * Create RDB snapshot of current dataset
     */
    createRDBSnapshot() {
        const snapshot = {
            version: '1.0',
            timestamp: Date.now(),
            data: {},
            expirations: {}
        };

        // Serialize all data
        for (const [key, value] of this.data.entries()) {
            // Skip expired keys
            if (!this.isKeyExpired(key)) {
                snapshot.data[key] = this.serializeValue(value);
                
                // Include expiration if set
                if (this.expiration.has(key)) {
                    snapshot.expirations[key] = this.expiration.get(key);
                }
            }
        }

        // Write to RDB file
        const rdbContent = JSON.stringify(snapshot, null, 2);
        
        // Create backup of existing RDB file
        if (fs.existsSync(this.rdbFilename)) {
            const backupFilename = `${this.rdbFilename}.backup.${Date.now()}`;
            fs.copyFileSync(this.rdbFilename, backupFilename);
            
            // Clean up old backups (keep only last 3)
            setTimeout(() => {
                try {
                    const backupFiles = fs.readdirSync('.')
                        .filter(file => file.startsWith(`${this.rdbFilename}.backup.`))
                        .sort();
                    
                    if (backupFiles.length > 3) {
                        for (let i = 0; i < backupFiles.length - 3; i++) {
                            fs.unlinkSync(backupFiles[i]);
                        }
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }
            }, 1000);
        }

        fs.writeFileSync(this.rdbFilename, rdbContent);
        
        this.rdbLastSaveTime = Date.now();
        this.rdbChangesSinceLastSave = 0;
        
        return Object.keys(snapshot.data).length;
    }

    /**
     * Serialize a value for RDB storage
     */
    serializeValue(value) {
        if (typeof value === 'string') {
            return { type: 'string', data: value };
        } else if (value instanceof RedisList) {
            return { type: 'list', data: value.toArray() };
        } else if (value instanceof RedisSet) {
            return { type: 'set', data: value.toArray() };
        } else if (value instanceof RedisHash) {
            return { 
                type: 'hash', 
                data: value.toObject(),
                fieldExpirations: Object.fromEntries(value.fieldExpirations)
            };
        } else if (value instanceof RedisSortedSet) {
            return { type: 'zset', data: value.toArray() };
        } else if (value instanceof RedisJSON) {
            return { type: 'json', data: value.toObject() };
        } else if (value instanceof RedisGeo) {
            return { type: 'geo', data: value.toArray() };
        } else if (value instanceof RedisBitmap) {
            return { type: 'bitmap', data: value.toArray() };
        } else if (value instanceof RedisStream) {
            return { type: 'stream', data: value.toArray() };
        } else {
            return { type: 'unknown', data: value };
        }
    }

    /**
     * Deserialize a value from RDB storage
     */
    deserializeValue(serialized) {
        const { type, data, fieldExpirations } = serialized;
        
        switch (type) {
            case 'string':
                return data;
            case 'list':
                const list = new RedisList();
                if (data.length > 0) {
                    list.rpush(...data);
                }
                return list;
            case 'set':
                const set = new RedisSet();
                if (data.length > 0) {
                    set.sadd(...data);
                }
                return set;
            case 'hash':
                const hash = new RedisHash();
                for (const [field, value] of Object.entries(data)) {
                    hash.hset(field, value);
                }
                // Restore field expirations
                if (fieldExpirations) {
                    for (const [field, expireTime] of Object.entries(fieldExpirations)) {
                        if (expireTime > Date.now()) {
                            hash.setFieldExpiration(field, expireTime);
                        }
                    }
                }
                return hash;
            case 'zset':
                const zset = new RedisSortedSet();
                for (const { member, score } of data) {
                    zset.zadd(score, member);
                }
                return zset;
            case 'json':
                const json = new RedisJSON();
                json.data = data;
                return json;
            case 'geo':
                const geo = new RedisGeo();
                for (const { member, longitude, latitude } of data) {
                    geo.geoadd(longitude, latitude, member);
                }
                return geo;
            case 'bitmap':
                const bitmap = new RedisBitmap();
                bitmap.fromArray(data);
                return bitmap;
            case 'stream':
                const stream = new RedisStream();
                stream.fromArray(data);
                return stream;
            default:
                return data;
        }
    }

    /**
     * SAVE - Save dataset to RDB snapshot synchronously
     * @param {Array<string>} args - Command arguments
     */
    save(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'save' command");
        }

        if (!this.rdbEnabled) {
            throw new Error("ERR RDB snapshots are not enabled");
        }

        try {
            const keyCount = this.createRDBSnapshot();
            return `OK - ${keyCount} keys saved to ${this.rdbFilename}`;
        } catch (error) {
            throw new Error(`ERR failed to save RDB snapshot: ${error.message}`);
        }
    }

    /**
     * BGSAVE - Save dataset to RDB snapshot in background
     * @param {Array<string>} args - Command arguments
     */
    bgsave(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'bgsave' command");
        }

        if (!this.rdbEnabled) {
            throw new Error("ERR RDB snapshots are not enabled");
        }

        if (this.rdbBgsaveInProgress) {
            throw new Error("ERR Background save already in progress");
        }

        // Simulate background save (in a real implementation, this would use worker threads)
        this.rdbBgsaveInProgress = true;
        
        setTimeout(() => {
            try {
                const keyCount = this.createRDBSnapshot();
                this.rdbBgsaveInProgress = false;
                console.log(`Background RDB save completed: ${keyCount} keys saved`);
            } catch (error) {
                this.rdbBgsaveInProgress = false;
                console.error(`Background RDB save failed: ${error.message}`);
            }
        }, 100); // Small delay to simulate background operation

        return 'Background saving started';
    }

    /**
     * LASTSAVE - Get timestamp of last successful RDB save
     * @param {Array<string>} args - Command arguments
     */
    lastsave(args) {
        if (args.length !== 0) {
            throw new Error("ERR wrong number of arguments for 'lastsave' command");
        }

        return `(integer) ${Math.floor(this.rdbLastSaveTime / 1000)}`;
    }

    // ============================================================================
    // Phase 12: Geospatial Data Commands
    // ============================================================================

    /**
     * GEOADD key longitude latitude member [longitude latitude member ...]
     * Add geospatial items to a geo index (sorted set)
     * @param {Array<string>} args - Command arguments
     */
    geoadd(args) {
        if (args.length < 4 || (args.length - 1) % 3 !== 0) {
            throw new Error("ERR wrong number of arguments for 'geoadd' command");
        }

        const key = args[0];
        const items = args.slice(1);

        // Check type if key exists
        if (this.data.has(key)) {
            this.checkType(key, 'geo');
        }

        let geo = this.data.get(key);
        if (!geo) {
            geo = new RedisGeo();
            this.setValue(key, geo, 'geo');
        }

        const added = geo.geoadd(...items);
        
        if (geo.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${added}`;
    }

    /**
     * GEODIST key member1 member2 [unit]
     * Get distance between two geospatial members
     * @param {Array<string>} args - Command arguments
     */
    geodist(args) {
        if (args.length < 3 || args.length > 4) {
            throw new Error("ERR wrong number of arguments for 'geodist' command");
        }

        const key = args[0];
        const member1 = args[1];
        const member2 = args[2];
        const unit = args[3] || 'm';

        if (!this.data.has(key)) {
            return '(nil)';
        }

        this.checkType(key, 'geo');
        const geo = this.data.get(key);
        
        const distance = geo.geodist(member1, member2, unit);
        return distance === null ? '(nil)' : `"${distance}"`;
    }

    /**
     * GEOPOS key member [member ...]
     * Get positions (longitude, latitude) of geospatial members
     * @param {Array<string>} args - Command arguments
     */
    geopos(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'geopos' command");
        }

        const key = args[0];
        const members = args.slice(1);

        if (!this.data.has(key)) {
            return members.map(() => '(nil)');
        }

        this.checkType(key, 'geo');
        const geo = this.data.get(key);
        
        const positions = geo.geopos(...members);
        return positions.map(pos => {
            if (pos === null) {
                return '(nil)';
            }
            return [`"${pos[0]}"`, `"${pos[1]}"`];
        });
    }

    /**
     * GEOHASH key member [member ...]
     * Get geohash strings for geospatial members
     * @param {Array<string>} args - Command arguments
     */
    geohash(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'geohash' command");
        }

        const key = args[0];
        const members = args.slice(1);

        if (!this.data.has(key)) {
            return members.map(() => '(nil)');
        }

        this.checkType(key, 'geo');
        const geo = this.data.get(key);
        
        const hashes = geo.geohash(...members);
        return hashes.map(hash => hash === null ? '(nil)' : `"${hash}"`);
    }

    /**
     * GEORADIUS key longitude latitude radius unit [WITHCOORD] [WITHDIST] [WITHHASH] [COUNT count] [ASC|DESC]
     * Search for members within radius from coordinates
     * @param {Array<string>} args - Command arguments
     */
    georadius(args) {
        if (args.length < 5) {
            throw new Error("ERR wrong number of arguments for 'georadius' command");
        }

        const key = args[0];
        const longitude = parseFloat(args[1]);
        const latitude = parseFloat(args[2]);
        const radius = parseFloat(args[3]);
        const unit = args[4];
        
        if (isNaN(longitude) || isNaN(latitude) || isNaN(radius)) {
            throw new Error("ERR value is not a valid float");
        }

        if (!this.data.has(key)) {
            return [];
        }

        this.checkType(key, 'geo');
        const geo = this.data.get(key);

        // Parse options
        const options = {};
        for (let i = 5; i < args.length; i++) {
            const option = args[i].toUpperCase();
            switch (option) {
                case 'WITHCOORD':
                    options.WITHCOORD = true;
                    break;
                case 'WITHDIST':
                    options.WITHDIST = true;
                    break;
                case 'WITHHASH':
                    options.WITHHASH = true;
                    break;
                case 'ASC':
                    options.ASC = true;
                    break;
                case 'DESC':
                    options.DESC = true;
                    break;
                case 'COUNT':
                    if (i + 1 < args.length) {
                        options.COUNT = parseInt(args[i + 1]);
                        i++; // Skip the count value
                    }
                    break;
            }
        }

        const results = geo.georadius(longitude, latitude, radius, unit, options);
        return this.formatGeoResults(results, options);
    }

    /**
     * GEORADIUSBYMEMBER key member radius unit [WITHCOORD] [WITHDIST] [WITHHASH] [COUNT count] [ASC|DESC]
     * Search for members within radius from another member
     * @param {Array<string>} args - Command arguments
     */
    georadiusbymember(args) {
        if (args.length < 4) {
            throw new Error("ERR wrong number of arguments for 'georadiusbymember' command");
        }

        const key = args[0];
        const member = args[1];
        const radius = parseFloat(args[2]);
        const unit = args[3];
        
        if (isNaN(radius)) {
            throw new Error("ERR value is not a valid float");
        }

        if (!this.data.has(key)) {
            return [];
        }

        this.checkType(key, 'geo');
        const geo = this.data.get(key);

        // Parse options (same as GEORADIUS)
        const options = {};
        for (let i = 4; i < args.length; i++) {
            const option = args[i].toUpperCase();
            switch (option) {
                case 'WITHCOORD':
                    options.WITHCOORD = true;
                    break;
                case 'WITHDIST':
                    options.WITHDIST = true;
                    break;
                case 'WITHHASH':
                    options.WITHHASH = true;
                    break;
                case 'ASC':
                    options.ASC = true;
                    break;
                case 'DESC':
                    options.DESC = true;
                    break;
                case 'COUNT':
                    if (i + 1 < args.length) {
                        options.COUNT = parseInt(args[i + 1]);
                        i++; // Skip the count value
                    }
                    break;
            }
        }

        const results = geo.georadiusbymember(member, radius, unit, options);
        return this.formatGeoResults(results, options);
    }

    /**
     * GEOSEARCH key FROMMEMBER member|FROMLONLAT longitude latitude BYRADIUS radius unit|BYBOX width height unit [options]
     * Modern geospatial search command (Redis 6.2+)
     * @param {Array<string>} args - Command arguments
     */
    geosearch(args) {
        if (args.length < 6) {
            throw new Error("ERR wrong number of arguments for 'geosearch' command");
        }

        const key = args[0];
        
        if (!this.data.has(key)) {
            return [];
        }

        this.checkType(key, 'geo');
        const geo = this.data.get(key);

        // Parse search origin
        let fromMember = null;
        let longitude = null;
        let latitude = null;
        let argIndex = 1;

        if (args[argIndex].toUpperCase() === 'FROMMEMBER') {
            fromMember = args[argIndex + 1];
            argIndex += 2;
        } else if (args[argIndex].toUpperCase() === 'FROMLONLAT') {
            longitude = parseFloat(args[argIndex + 1]);
            latitude = parseFloat(args[argIndex + 2]);
            if (isNaN(longitude) || isNaN(latitude)) {
                throw new Error("ERR value is not a valid float");
            }
            argIndex += 3;
        } else {
            throw new Error("ERR GEOSEARCH requires FROMMEMBER or FROMLONLAT");
        }

        // Parse shape
        let shape = {};
        if (args[argIndex].toUpperCase() === 'BYRADIUS') {
            shape.radius = parseFloat(args[argIndex + 1]);
            shape.unit = args[argIndex + 2];
            if (isNaN(shape.radius)) {
                throw new Error("ERR value is not a valid float");
            }
            argIndex += 3;
        } else if (args[argIndex].toUpperCase() === 'BYBOX') {
            shape.width = parseFloat(args[argIndex + 1]);
            shape.height = parseFloat(args[argIndex + 2]);
            shape.unit = args[argIndex + 3];
            if (isNaN(shape.width) || isNaN(shape.height)) {
                throw new Error("ERR value is not a valid float");
            }
            argIndex += 4;
        } else {
            throw new Error("ERR GEOSEARCH requires BYRADIUS or BYBOX");
        }

        // Parse options
        const options = {};
        for (let i = argIndex; i < args.length; i++) {
            const option = args[i].toUpperCase();
            switch (option) {
                case 'WITHCOORD':
                    options.WITHCOORD = true;
                    break;
                case 'WITHDIST':
                    options.WITHDIST = true;
                    break;
                case 'WITHHASH':
                    options.WITHHASH = true;
                    break;
                case 'ASC':
                    options.ASC = true;
                    break;
                case 'DESC':
                    options.DESC = true;
                    break;
                case 'COUNT':
                    if (i + 1 < args.length) {
                        options.COUNT = parseInt(args[i + 1]);
                        i++; // Skip the count value
                    }
                    break;
            }
        }

        const results = geo.geosearch(fromMember, longitude, latitude, shape, options);
        return this.formatGeoResults(results, options);
    }

    /**
     * GEOSEARCHSTORE destination source FROMMEMBER member|FROMLONLAT longitude latitude BYRADIUS radius unit|BYBOX width height unit [options]
     * Store GEOSEARCH results in destination key
     * @param {Array<string>} args - Command arguments
     */
    geosearchstore(args) {
        if (args.length < 7) {
            throw new Error("ERR wrong number of arguments for 'geosearchstore' command");
        }

        const destination = args[0];
        const newArgs = args.slice(1); // Remove destination, pass rest to geosearch
        
        // Execute geosearch to get results
        const results = this.geosearch(newArgs);
        
        if (results.length === 0) {
            return '(integer) 0';
        }

        // Create new geo index with results
        const destGeo = new RedisGeo();
        let stored = 0;

        for (const result of results) {
            if (Array.isArray(result)) {
                // Simple member name
                const member = result[0] || result;
                // We need to get coordinates from original geo
                const sourceKey = newArgs[0];
                if (this.data.has(sourceKey)) {
                    const sourceGeo = this.data.get(sourceKey);
                    const coords = sourceGeo.geopos(member)[0];
                    if (coords) {
                        destGeo.geoadd(coords[0], coords[1], member);
                        stored++;
                    }
                }
            } else if (result.member) {
                // Result object with member and potentially coordinates
                const member = result.member;
                if (result.coordinates) {
                    destGeo.geoadd(result.coordinates[0], result.coordinates[1], member);
                    stored++;
                }
            }
        }

        if (stored > 0) {
            this.setValue(destination, destGeo, 'geo');
        }

        return `(integer) ${stored}`;
    }

    /**
     * Format geospatial search results for output
     * @param {Array} results - Raw search results
     * @param {Object} options - Formatting options
     * @returns {Array} Formatted results
     */
    formatGeoResults(results, options) {
        return results.map(result => {
            const formatted = [`"${result.member}"`];
            
            if (options.WITHDIST) {
                formatted.push(`"${result.distanceFormatted}"`);
            }
            
            if (options.WITHHASH) {
                formatted.push(`(integer) ${result.geohash}`);
            }
            
            if (options.WITHCOORD) {
                formatted.push([`"${result.coordinates[0]}"`, `"${result.coordinates[1]}"`]);
            }
            
            return formatted.length === 1 ? formatted[0] : formatted;
        });
    }

    // ============================================================================
    // Phase 13: Bitmap & Bitfield Commands
    // ============================================================================

    /**
     * SETBIT key offset value
     * Set bit at specified offset to value (0 or 1)
     * @param {Array<string>} args - Command arguments
     */
    setbit(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'setbit' command");
        }

        const key = args[0];
        const offset = parseInt(args[1]);
        const value = parseInt(args[2]);

        if (isNaN(offset) || offset < 0) {
            throw new Error("ERR bit offset is not an integer or out of range");
        }

        if (value !== 0 && value !== 1) {
            throw new Error("ERR bit is not an integer or out of range");
        }

        // Check type if key exists
        if (this.data.has(key)) {
            this.checkType(key, 'bitmap');
        }

        let bitmap = this.data.get(key);
        if (!bitmap) {
            bitmap = new RedisBitmap();
            this.setValue(key, bitmap, 'bitmap');
        }

        const previousValue = bitmap.setbit(offset, value);
        
        if (bitmap.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${previousValue}`;
    }

    /**
     * GETBIT key offset
     * Get bit value at specified offset
     * @param {Array<string>} args - Command arguments
     */
    getbit(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'getbit' command");
        }

        const key = args[0];
        const offset = parseInt(args[1]);

        if (isNaN(offset) || offset < 0) {
            throw new Error("ERR bit offset is not an integer or out of range");
        }

        if (!this.data.has(key)) {
            return '(integer) 0';
        }

        this.checkType(key, 'bitmap');
        const bitmap = this.data.get(key);
        
        const bit = bitmap.getbit(offset);
        return `(integer) ${bit}`;
    }

    /**
     * BITCOUNT key [start end]
     * Count number of set bits in range
     * @param {Array<string>} args - Command arguments
     */
    bitcount(args) {
        if (args.length < 1 || args.length > 3) {
            throw new Error("ERR wrong number of arguments for 'bitcount' command");
        }

        const key = args[0];
        
        if (!this.data.has(key)) {
            return '(integer) 0';
        }

        this.checkType(key, 'bitmap');
        const bitmap = this.data.get(key);

        let start = 0;
        let end = -1;

        if (args.length >= 2) {
            start = parseInt(args[1]);
            if (isNaN(start)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        if (args.length >= 3) {
            end = parseInt(args[2]);
            if (isNaN(end)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        const count = bitmap.bitcount(start, end);
        return `(integer) ${count}`;
    }

    /**
     * BITPOS key bit [start [end]]
     * Find first bit set to specified value
     * @param {Array<string>} args - Command arguments
     */
    bitpos(args) {
        if (args.length < 2 || args.length > 4) {
            throw new Error("ERR wrong number of arguments for 'bitpos' command");
        }

        const key = args[0];
        const bit = parseInt(args[1]);

        if (bit !== 0 && bit !== 1) {
            throw new Error("ERR bit is not an integer or out of range");
        }

        if (!this.data.has(key)) {
            return bit === 0 ? '(integer) 0' : '(integer) -1';
        }

        this.checkType(key, 'bitmap');
        const bitmap = this.data.get(key);

        let start = 0;
        let end = -1;

        if (args.length >= 3) {
            start = parseInt(args[2]);
            if (isNaN(start)) {
                throw new Error("ERR value is not an integer or out of range");
            }
            start = start * 8; // Convert byte position to bit position
        }

        if (args.length >= 4) {
            end = parseInt(args[3]);
            if (isNaN(end)) {
                throw new Error("ERR value is not an integer or out of range");
            }
            end = end * 8 + 7; // Convert byte position to bit position (end of byte)
        }

        const position = bitmap.bitpos(bit, start, end);
        return `(integer) ${position}`;
    }

    /**
     * BITOP operation destkey key [key ...]
     * Perform bitwise operation between bitmaps
     * @param {Array<string>} args - Command arguments
     */
    bitop(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'bitop' command");
        }

        const operation = args[0].toUpperCase();
        const destKey = args[1];
        const sourceKeys = args.slice(2);

        if (!['AND', 'OR', 'XOR', 'NOT'].includes(operation)) {
            throw new Error("ERR operation must be AND, OR, XOR, or NOT");
        }

        if (operation === 'NOT' && sourceKeys.length !== 1) {
            throw new Error("ERR BITOP NOT must be called with a single source key");
        }

        // Get source bitmaps
        const sourceBitmaps = [];
        for (const key of sourceKeys) {
            if (this.data.has(key)) {
                this.checkType(key, 'bitmap');
                sourceBitmaps.push(this.data.get(key));
            } else {
                sourceBitmaps.push(new RedisBitmap()); // Empty bitmap
            }
        }

        let result;
        if (operation === 'NOT') {
            result = sourceBitmaps[0].bitop('NOT');
        } else {
            result = sourceBitmaps[0];
            for (let i = 1; i < sourceBitmaps.length; i++) {
                result = result.bitop(operation, sourceBitmaps[i]);
            }
        }

        // Store result
        if (result.isEmpty()) {
            this.deleteKey(destKey);
        } else {
            this.setValue(destKey, result, 'bitmap');
        }

        return `(integer) ${result.size()}`;
    }

    /**
     * BITFIELD key [GET type offset] [SET type offset value] [INCRBY type offset increment] [OVERFLOW WRAP|SAT|FAIL]
     * Perform bitfield operations
     * @param {Array<string>} args - Command arguments
     */
    bitfield(args) {
        if (args.length < 1) {
            throw new Error("ERR wrong number of arguments for 'bitfield' command");
        }

        const key = args[0];
        
        // Check type if key exists
        if (this.data.has(key)) {
            this.checkType(key, 'bitmap');
        }

        let bitmap = this.data.get(key);
        if (!bitmap) {
            bitmap = new RedisBitmap();
            this.setValue(key, bitmap, 'bitmap');
        }

        // Parse operations
        const operations = [];
        let i = 1;

        while (i < args.length) {
            const command = args[i].toUpperCase();
            
            switch (command) {
                case 'GET':
                    if (i + 2 >= args.length) {
                        throw new Error("ERR syntax error");
                    }
                    operations.push({
                        command: 'GET',
                        type: args[i + 1],
                        offset: args[i + 2]
                    });
                    i += 3;
                    break;
                
                case 'SET':
                    if (i + 3 >= args.length) {
                        throw new Error("ERR syntax error");
                    }
                    operations.push({
                        command: 'SET',
                        type: args[i + 1],
                        offset: args[i + 2],
                        value: parseInt(args[i + 3])
                    });
                    i += 4;
                    break;
                
                case 'INCRBY':
                    if (i + 3 >= args.length) {
                        throw new Error("ERR syntax error");
                    }
                    operations.push({
                        command: 'INCRBY',
                        type: args[i + 1],
                        offset: args[i + 2],
                        value: parseInt(args[i + 3])
                    });
                    i += 4;
                    break;
                
                case 'OVERFLOW':
                    if (i + 1 >= args.length) {
                        throw new Error("ERR syntax error");
                    }
                    const behavior = args[i + 1].toUpperCase();
                    if (!['WRAP', 'SAT', 'FAIL'].includes(behavior)) {
                        throw new Error("ERR Invalid overflow type, must be WRAP, SAT or FAIL");
                    }
                    operations.push({
                        behavior: behavior
                    });
                    i += 2;
                    break;
                
                default:
                    throw new Error("ERR syntax error");
            }
        }

        if (operations.length === 0) {
            throw new Error("ERR syntax error");
        }

        const results = bitmap.bitfield(operations);
        
        if (bitmap.isEmpty()) {
            this.deleteKey(key);
        }

        // Format results
        return results.map(result => {
            if (result === null) {
                return '(nil)';
            }
            return `(integer) ${result}`;
        });
    }

    /**
     * BITFIELD_RO key [GET type offset] [GET type offset ...]
     * Read-only bitfield operations (Redis 6.0+)
     * @param {Array<string>} args - Command arguments
     */
    bitfieldRo(args) {
        if (args.length < 1) {
            throw new Error("ERR wrong number of arguments for 'bitfield_ro' command");
        }

        const key = args[0];
        
        if (!this.data.has(key)) {
            // Return array of zeros for non-existent key
            const numOperations = Math.floor((args.length - 1) / 3);
            return new Array(numOperations).fill('(integer) 0');
        }

        this.checkType(key, 'bitmap');
        const bitmap = this.data.get(key);

        // Parse operations - only GET is allowed
        const operations = [];
        let i = 1;

        while (i < args.length) {
            const command = args[i].toUpperCase();
            
            if (command !== 'GET') {
                throw new Error("ERR BITFIELD_RO only supports GET operations");
            }
            
            if (i + 2 >= args.length) {
                throw new Error("ERR syntax error");
            }
            
            operations.push({
                command: 'GET',
                type: args[i + 1],
                offset: args[i + 2]
            });
            i += 3;
        }

        if (operations.length === 0) {
            throw new Error("ERR syntax error");
        }

        const results = bitmap.bitfield(operations);

        // Format results
        return results.map(result => {
            if (result === null) {
                return '(nil)';
            }
            return `(integer) ${result}`;
        });
    }

    // ============================================================================
    // Phase 14: Stream Commands
    // ============================================================================

    /**
     * XADD key id field value [field value ...]
     * Add entry to stream
     * @param {Array<string>} args - Command arguments
     */
    xadd(args) {
        if (args.length < 4 || args.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for 'xadd' command");
        }

        const key = args[0];
        const id = args[1];
        const fieldValues = args.slice(2);

        // Check type if key exists
        if (this.data.has(key)) {
            this.checkType(key, 'stream');
        }

        let stream = this.data.get(key);
        if (!stream) {
            stream = new RedisStream();
            this.setValue(key, stream, 'stream');
        }

        try {
            const entryId = stream.xadd(id, fieldValues);
            return `"${entryId}"`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * XLEN key
     * Get number of entries in stream
     * @param {Array<string>} args - Command arguments
     */
    xlen(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'xlen' command");
        }

        const key = args[0];

        if (!this.data.has(key)) {
            return '(integer) 0';
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        return `(integer) ${stream.xlen()}`;
    }

    /**
     * XRANGE key start end [COUNT count]
     * Get range of entries from stream
     * @param {Array<string>} args - Command arguments
     */
    xrange(args) {
        if (args.length < 3 || args.length > 5) {
            throw new Error("ERR wrong number of arguments for 'xrange' command");
        }

        const key = args[0];
        const start = args[1];
        const end = args[2];
        let count = -1;

        // Parse COUNT option
        if (args.length === 5 && args[3].toUpperCase() === 'COUNT') {
            count = parseInt(args[4]);
            if (isNaN(count) || count < 0) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        if (!this.data.has(key)) {
            return [];
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        const entries = stream.xrange(start, end, count);
        return this.formatStreamEntries(entries);
    }

    /**
     * XREVRANGE key end start [COUNT count]
     * Get reverse range of entries from stream
     * @param {Array<string>} args - Command arguments
     */
    xrevrange(args) {
        if (args.length < 3 || args.length > 5) {
            throw new Error("ERR wrong number of arguments for 'xrevrange' command");
        }

        const key = args[0];
        const start = args[1];
        const end = args[2];
        let count = -1;

        // Parse COUNT option
        if (args.length === 5 && args[3].toUpperCase() === 'COUNT') {
            count = parseInt(args[4]);
            if (isNaN(count) || count < 0) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }

        if (!this.data.has(key)) {
            return [];
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        const entries = stream.xrevrange(start, end, count);
        return this.formatStreamEntries(entries);
    }

    /**
     * XDEL key id [id ...]
     * Delete entries from stream
     * @param {Array<string>} args - Command arguments
     */
    xdel(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'xdel' command");
        }

        const key = args[0];
        const ids = args.slice(1);

        if (!this.data.has(key)) {
            return '(integer) 0';
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        const deletedCount = stream.xdel(ids);
        
        if (stream.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${deletedCount}`;
    }

    /**
     * XTRIM key MAXLEN|MINID [~] count|id
     * Trim stream to maximum length or minimum ID
     * @param {Array<string>} args - Command arguments
     */
    xtrim(args) {
        if (args.length < 3 || args.length > 4) {
            throw new Error("ERR wrong number of arguments for 'xtrim' command");
        }

        const key = args[0];
        const strategy = args[1].toUpperCase();
        
        if (strategy !== 'MAXLEN' && strategy !== 'MINID') {
            throw new Error("ERR syntax error");
        }

        let approximate = false;
        let valueIndex = 2;

        // Check for ~ (approximate) flag
        if (args[2] === '~') {
            approximate = true;
            valueIndex = 3;
            if (args.length !== 4) {
                throw new Error("ERR syntax error");
            }
        }

        if (!this.data.has(key)) {
            return '(integer) 0';
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        let removedCount = 0;

        if (strategy === 'MAXLEN') {
            const count = parseInt(args[valueIndex]);
            if (isNaN(count) || count < 0) {
                throw new Error("ERR value is not an integer or out of range");
            }
            removedCount = stream.xtrim(count, approximate);
        } else if (strategy === 'MINID') {
            const minId = args[valueIndex];
            
            // Validate ID format
            if (!stream.isValidId(minId)) {
                throw new Error("ERR Invalid stream ID specified");
            }
            
            // Remove entries with ID smaller than minId
            const entriesToRemove = [];
            for (const [id, entry] of stream.entries) {
                if (stream.compareIds(id, minId) < 0) {
                    entriesToRemove.push(id);
                } else {
                    break; // Since entries are ordered, we can stop here
                }
            }
            
            removedCount = stream.xdel(entriesToRemove);
        }
        
        if (stream.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * XREAD [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]
     * Read entries from one or more streams
     * @param {Array<string>} args - Command arguments
     */
    xread(args) {
        if (args.length < 3) {
            throw new Error("ERR wrong number of arguments for 'xread' command");
        }

        let count = -1;
        let block = -1;
        let streamsIndex = -1;

        // Parse options
        let i = 0;
        while (i < args.length) {
            const arg = args[i].toUpperCase();
            
            if (arg === 'COUNT') {
                if (i + 1 >= args.length) {
                    throw new Error("ERR syntax error");
                }
                count = parseInt(args[i + 1]);
                if (isNaN(count) || count < 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i += 2;
            } else if (arg === 'BLOCK') {
                if (i + 1 >= args.length) {
                    throw new Error("ERR syntax error");
                }
                block = parseInt(args[i + 1]);
                if (isNaN(block) || block < 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i += 2;
            } else if (arg === 'STREAMS') {
                streamsIndex = i + 1;
                break;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        if (streamsIndex === -1) {
            throw new Error("ERR syntax error");
        }

        const streamArgs = args.slice(streamsIndex);
        if (streamArgs.length % 2 !== 0) {
            throw new Error("ERR Unbalanced XREAD list of streams: for each stream key an ID or '$' must be specified");
        }

        const numStreams = streamArgs.length / 2;
        const keys = streamArgs.slice(0, numStreams);
        const ids = streamArgs.slice(numStreams);

        const results = [];

        for (let j = 0; j < numStreams; j++) {
            const key = keys[j];
            const startId = ids[j];

            if (!this.data.has(key)) {
                continue; // Skip non-existent streams
            }

            this.checkType(key, 'stream');
            const stream = this.data.get(key);

            let actualStartId = startId;
            if (startId === '$') {
                // '$' means start from next entry after last
                const lastId = stream.getLastId();
                if (lastId) {
                    const parsed = stream.parseId(lastId);
                    actualStartId = `${parsed.timestamp}-${parsed.sequence + 1}`;
                } else {
                    actualStartId = '0-1';
                }
            }

            // Get entries after the specified ID
            const entries = stream.xrange(actualStartId, '+', count);
            
            if (entries.length > 0) {
                results.push([key, this.formatStreamEntries(entries)]);
            }
        }

        // For blocking reads, we would need to implement a waiting mechanism
        // For now, return immediate results
        return results.length > 0 ? results : [];
    }

    /**
     * Format stream entries for output
     * @param {Array} entries - Array of [id, [field, value, ...]]
     * @returns {Array} Formatted entries
     */
    formatStreamEntries(entries) {
        return entries.map(([id, fields]) => [
            `"${id}"`,
            fields.map(field => `"${field}"`)
        ]);
    }

    /**
     * XGROUP subcommand ...
     * Manage consumer groups
     * @param {Array<string>} args - Command arguments
     */
    xgroup(args) {
        if (args.length < 1) {
            throw new Error("ERR wrong number of arguments for 'xgroup' command");
        }

        const subcommand = args[0].toUpperCase();

        switch (subcommand) {
            case 'CREATE':
                return this.xgroupCreate(args.slice(1));
            case 'DESTROY':
                return this.xgroupDestroy(args.slice(1));
            case 'DELCONSUMER':
                return this.xgroupDelConsumer(args.slice(1));
            case 'SETID':
                return this.xgroupSetId(args.slice(1));
            case 'CREATECONSUMER':
                return this.xgroupCreateConsumer(args.slice(1));
            default:
                throw new Error("ERR Unknown subcommand or wrong number of arguments for 'xgroup' command");
        }
    }

    /**
     * XGROUP CREATE key groupname id
     * Create consumer group
     * @param {Array<string>} args - Command arguments
     */
    xgroupCreate(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'xgroup create' command");
        }

        const key = args[0];
        const groupName = args[1];
        const id = args[2];

        // Create stream if it doesn't exist (for group creation)
        if (!this.data.has(key)) {
            const stream = new RedisStream();
            this.setValue(key, stream, 'stream');
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        const created = stream.xgroupCreate(groupName, id);
        
        if (!created) {
            throw new Error("BUSYGROUP Consumer Group name already exists");
        }

        return 'OK';
    }

    /**
     * XGROUP DESTROY key groupname
     * Destroy consumer group
     * @param {Array<string>} args - Command arguments
     */
    xgroupDestroy(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'xgroup destroy' command");
        }

        const key = args[0];
        const groupName = args[1];

        if (!this.data.has(key)) {
            return '(integer) 0';
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        const destroyed = stream.xgroupDestroy(groupName);
        return `(integer) ${destroyed ? 1 : 0}`;
    }

    /**
     * XGROUP DELCONSUMER key groupname consumername
     * Delete consumer from group
     * @param {Array<string>} args - Command arguments
     */
    xgroupDelConsumer(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'xgroup delconsumer' command");
        }

        const key = args[0];
        const groupName = args[1];
        const consumerName = args[2];

        if (!this.data.has(key)) {
            throw new Error("NOGROUP No such key or consumer group");
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        try {
            const pendingCount = stream.xgroupDelConsumer(groupName, consumerName);
            return `(integer) ${pendingCount}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * XGROUP SETID key groupname id
     * Set consumer group last delivered ID
     * @param {Array<string>} args - Command arguments
     */
    xgroupSetId(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'xgroup setid' command");
        }

        const key = args[0];
        const groupName = args[1];
        const id = args[2];

        if (!this.data.has(key)) {
            throw new Error("NOGROUP No such key or consumer group");
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        try {
            stream.xgroupSetId(groupName, id);
            return 'OK';
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * XGROUP CREATECONSUMER key groupname consumername
     * Create consumer in group without reading
     * @param {Array<string>} args - Command arguments
     */
    xgroupCreateConsumer(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'xgroup createconsumer' command");
        }

        const key = args[0];
        const groupName = args[1];
        const consumerName = args[2];

        if (!this.data.has(key)) {
            throw new Error("NOGROUP No such key or consumer group");
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        try {
            const created = stream.xgroupCreateConsumer(groupName, consumerName);
            return `(integer) ${created ? 1 : 0}`;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * Placeholder implementations for complex consumer group operations
     * These would require more complex logic for pending entry lists
     */
    
    /**
     * XREADGROUP GROUP group consumer [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]
     * Read from stream as consumer group
     */
    xreadgroup(args) {
        // Simplified implementation - full implementation would require PEL management
        throw new Error("ERR XREADGROUP not fully implemented in this demo");
    }

    /**
     * XACK key group id [id ...]
     * Acknowledge processed entries
     */
    xack(args) {
        // Simplified implementation - full implementation would require PEL management
        throw new Error("ERR XACK not fully implemented in this demo");
    }

    /**
     * XPENDING key group [start end count] [consumer]
     * Get pending entries info
     */
    xpending(args) {
        // Simplified implementation - full implementation would require PEL management
        throw new Error("ERR XPENDING not fully implemented in this demo");
    }

    /**
     * XCLAIM key group consumer min-idle-time id [id ...] [options]
     * Claim pending entries
     */
    xclaim(args) {
        // Simplified implementation - full implementation would require PEL management
        throw new Error("ERR XCLAIM not fully implemented in this demo");
    }

    /**
     * XINFO subcommand key [args]
     * Get stream information
     */
    xinfo(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'xinfo' command");
        }

        const subcommand = args[0].toUpperCase();
        const key = args[1];

        if (!this.data.has(key)) {
            throw new Error("ERR no such key");
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        switch (subcommand) {
            case 'STREAM':
                return [
                    'length', `(integer) ${stream.xlen()}`,
                    'radix-tree-keys', '(integer) 1',
                    'radix-tree-nodes', '(integer) 2',
                    'groups', `(integer) ${stream.consumerGroups.size}`,
                    'last-generated-id', `"${stream.lastGeneratedId}"`,
                    'first-entry', stream.getFirstId() ? this.formatStreamEntries([[stream.getFirstId(), []]]) : '(nil)',
                    'last-entry', stream.getLastId() ? this.formatStreamEntries([[stream.getLastId(), []]]) : '(nil)'
                ];
            case 'GROUPS':
                // Return info about consumer groups
                return Array.from(stream.consumerGroups.entries()).map(([name, group]) => [
                    'name', `"${name}"`,
                    'consumers', `(integer) ${group.consumers.size}`,
                    'pending', `(integer) ${group.pel.size}`,
                    'last-delivered-id', `"${group.lastDeliveredId}"`
                ]);
            case 'CONSUMERS':
                if (args.length !== 3) {
                    throw new Error("ERR wrong number of arguments for 'xinfo consumers' command");
                }
                const groupName = args[2];
                const group = stream.consumerGroups.get(groupName);
                if (!group) {
                    throw new Error("NOGROUP No such consumer group");
                }
                return Array.from(group.consumers.entries()).map(([name, consumer]) => [
                    'name', `"${name}"`,
                    'pending', `(integer) ${consumer.pending ? consumer.pending.size : 0}`,
                    'idle', `(integer) ${Date.now() - (consumer.lastSeen || 0)}`
                ]);
            default:
                throw new Error("ERR Unknown subcommand for 'xinfo' command");
        }
    }

    /**
     * XSETID key id
     * Set stream last generated ID
     * @param {Array<string>} args - Command arguments
     */
    xsetid(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'xsetid' command");
        }

        const key = args[0];
        const id = args[1];

        if (!this.data.has(key)) {
            throw new Error("ERR no such key");
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        try {
            stream.xsetid(id);
            return 'OK';
        } catch (error) {
            throw new Error(error.message);
        }
    }

    /**
     * XAUTOCLAIM key group consumer min-idle-time start [COUNT count] [JUSTID]
     * Auto-claim pending entries from idle consumers
     * @param {Array<string>} args - Command arguments
     */
    xautoclaim(args) {
        if (args.length < 5) {
            throw new Error("ERR wrong number of arguments for 'xautoclaim' command");
        }

        const key = args[0];
        const groupName = args[1];
        const consumerName = args[2];
        const minIdleTime = parseInt(args[3]);
        const start = args[4];

        if (isNaN(minIdleTime) || minIdleTime < 0) {
            throw new Error("ERR value is not an integer or out of range");
        }

        if (!this.data.has(key)) {
            return ['0-0', []];
        }

        this.checkType(key, 'stream');
        const stream = this.data.get(key);

        // Parse options
        let count = -1;
        let justId = false;

        for (let i = 5; i < args.length; i++) {
            const arg = args[i].toUpperCase();
            if (arg === 'COUNT') {
                if (i + 1 >= args.length) {
                    throw new Error("ERR syntax error");
                }
                count = parseInt(args[i + 1]);
                if (isNaN(count) || count < 0) {
                    throw new Error("ERR value is not an integer or out of range");
                }
                i++; // Skip the count value
            } else if (arg === 'JUSTID') {
                justId = true;
            } else {
                throw new Error("ERR syntax error");
            }
        }

        try {
            const [nextId, claimedEntries] = stream.xautoclaim(groupName, consumerName, minIdleTime, start, count);
            
            if (justId) {
                // Return only the entry IDs
                const justIds = claimedEntries.map(([id, fields]) => `"${id}"`);
                return [nextId, justIds];
            } else {
                // Return full entries
                return [nextId, this.formatStreamEntries(claimedEntries)];
            }
        } catch (error) {
            throw new Error(error.message);
        }
    }
}

new RedisClone();
